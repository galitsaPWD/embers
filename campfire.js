import { ref, onMounted, onUnmounted, watch } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import * as THREE from "https://unpkg.com/three@0.150.0/build/three.module.js";

export const Campfire = {
    props: ['mode', 'userCount', 'userIds', 'participants', 'activeMessages', 'isMuted', 'seed', 'allowRising'],
    template: `
        <div class="campfire-background" :class="{ 'chat-mode': mode === 'public' || mode === 'private', 'landing-mode': mode === 'landing' }">
            <div class="campfire-content">
                <div ref="container" class="three-container"></div>
                <div class="aura aura-outer" v-if="mode === 'public' || mode === 'private'"></div>
                <div class="aura" v-if="mode === 'public' || mode === 'private'"></div> 
            </div>
            <div class="vignette"></div>
        </div>
    `,
    setup(props, { expose, emit }) {
        const container = ref(null);
        let fuel = 0;
        let targetFuel = 0;
        let scene, camera, renderer, particles, logs, fireLight, shadowsGroup;
        let ground, groundGlow, bodyEmbers;
        let forestContainer, skyContainer;
        let foliageMat, trunkMat;
        let stars, moonGroup, fireflies;
        let ambientLight;
        let _seed = 12345;
        let animationId;
        let audioController = null;
        let isLoaded = false;
        let lastKnownNewestTime = 0;

        const PARTICLE_COUNT = 800;
        const BASELINE_FUEL = 0.25;
        const activeParticleCount = ref(150);

        onMounted(() => {
            initThree();
            updateShadows(props.participants || []);
            animate();
            window.addEventListener('resize', onResize);
        });

        onUnmounted(() => {
            if (animationId) cancelAnimationFrame(animationId);
            window.removeEventListener('resize', onResize);
            if (renderer) {
                renderer.dispose();
                renderer.forceContextLoss();
            }
            if (forestContainer) {
                forestContainer.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
            if (foliageMat) foliageMat.dispose();
            if (trunkMat) trunkMat.dispose();
        });

        watch([() => props.participants, () => props.seed], ([newParts, newSeed]) => {
            if (!isLoaded) return;
            if (newSeed) setupForest(newSeed);
            updateShadows(newParts || []);
        }, { deep: true });

        watch(() => props.userCount, (count) => {
            const userPulse = Math.min((count || 0) * 0.4, 1.25);
            targetFuel = BASELINE_FUEL + userPulse;
        }, { immediate: true });

        watch(() => props.isMuted, (muted) => {
            if (audioController) audioController.setMuted(muted);
        });

        // -- Active Messages (Speech Bubbles) --
        watch(() => props.activeMessages, (msgs) => {
            if (!shadowsGroup || !isLoaded) return;

            // 1. If no messages (Immersive OFF or room empty), hide all EXCEPT those burning out
            if (!msgs || msgs.length === 0) {
                shadowsGroup.traverse(c => {
                    if (c.name === 'msgBubble' && !c.userData.isBurningOut) {
                        c.visible = false;
                        c.userData.shouldShow = false;
                        c.userData.lastText = '';
                    }
                });
                return;
            }

            // 2. Identify "Orphans" (Messages that were just deleted from Firestore)
            shadowsGroup.traverse(c => {
                if (c.name === 'msgBubble' && c.userData.shouldShow && !c.userData.isBurningOut) {
                    const isStillActive = msgs.some(m => m.senderId === c.userData.senderId);
                    if (!isStillActive) {
                        // Start Forced Evaporation
                        c.userData.isBurningOut = true;
                        c.userData.burnStartedAt = Date.now();
                    }
                }
            });

            // 3. Update active ones
            msgs.forEach(msg => {
                const shadow = shadowsGroup.children.find(s => s.userData.id === msg.senderId);
                if (shadow) {
                    updateSpeechBubble(shadow, msg.text, msg.createdAt);
                }
            });
        }, { deep: true });

        const createMessageTexture = (text) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Revert to Classic 2:1 Dimensions
            canvas.width = 1024;
            canvas.height = 512;

            const len = text.length;
            let fontSize = 42 * 2;
            if (len < 12) fontSize = 52 * 2;
            ctx.font = `bold ${fontSize}px "Outfit", sans-serif`;

            const words = text.split(/\s+/);
            let lines = [];
            let currentLine = '';

            // Narrower Bubble Body
            const bubbleW = 640;
            const maxWidth = bubbleW - 160;

            words.forEach(word => {
                if (ctx.measureText(word).width > maxWidth) {
                    if (currentLine) lines.push(currentLine);
                    currentLine = '';
                    const chars = word.split('');
                    let temp = '';
                    chars.forEach(c => {
                        if (ctx.measureText(temp + c).width < maxWidth) temp += c;
                        else { lines.push(temp); temp = c; }
                    });
                    currentLine = temp;
                } else {
                    let test = currentLine ? currentLine + ' ' + word : word;
                    if (ctx.measureText(test).width < maxWidth) currentLine = test;
                    else { lines.push(currentLine); currentLine = word; }
                }
            });
            if (currentLine) lines.push(currentLine);
            if (lines.length > 3) lines = lines.slice(0, 3);

            const lineSpacing = fontSize * 1.2;
            const contentH = lines.length * lineSpacing;
            const bubbleH = contentH + 120;

            const x = (canvas.width - bubbleW) / 2;
            const y = (canvas.height - bubbleH) / 2 - 20;
            const radius = 50;

            // 1. Shadow
            ctx.shadowBlur = 30;
            ctx.shadowColor = 'rgba(0,0,0,0.8)';

            // 2. Glass Background
            const bgGradient = ctx.createLinearGradient(x, y, x, y + bubbleH);
            bgGradient.addColorStop(0, 'rgba(15, 15, 20, 0.95)');
            bgGradient.addColorStop(1, 'rgba(5, 5, 8, 0.98)');
            ctx.fillStyle = bgGradient;

            // 3. Shape
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + bubbleW - radius, y);
            ctx.quadraticCurveTo(x + bubbleW, y, x + bubbleW, y + radius);
            ctx.lineTo(x + bubbleW, y + bubbleH - radius);
            ctx.quadraticCurveTo(x + bubbleW, y + bubbleH, x + bubbleW - radius, y + bubbleH);

            // Tail
            ctx.lineTo(canvas.width / 2 + 25, y + bubbleH);
            ctx.lineTo(canvas.width / 2, y + bubbleH + 45);
            ctx.lineTo(canvas.width / 2 - 25, y + bubbleH);

            ctx.lineTo(x + radius, y + bubbleH);
            ctx.quadraticCurveTo(x, y + bubbleH, x, y + bubbleH - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fill();

            // 4. Glowing Rim (Amber Bottom)
            ctx.shadowBlur = 0;
            const rimGradient = ctx.createLinearGradient(x, y, x, y + bubbleH);
            rimGradient.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
            rimGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
            rimGradient.addColorStop(1, 'rgba(255, 120, 0, 0.8)'); // Burning amber

            ctx.strokeStyle = rimGradient;
            ctx.lineWidth = 3;
            ctx.stroke();

            // 5. Inner Glow
            const innerGlow = ctx.createRadialGradient(canvas.width / 2, y + bubbleH, 10, canvas.width / 2, y + bubbleH, 150);
            innerGlow.addColorStop(0, 'rgba(255, 100, 0, 0.1)');
            innerGlow.addColorStop(1, 'rgba(255, 100, 0, 0)');
            ctx.fillStyle = innerGlow;
            ctx.fill();
            ctx.stroke(); // Subtle outline reinforcement

            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${fontSize}px "Outfit", sans-serif`;

            const startY = y + (bubbleH / 2) - (contentH / 2) + (fontSize * 0.35);
            lines.forEach((line, i) => {
                ctx.fillText(line, canvas.width / 2, startY + i * lineSpacing);
            });

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return { tex };
        };

        const updateSpeechBubble = (shadow, text, createdAt) => {
            let bubble = shadow.children.find(c => c.name === 'msgBubble');
            if (!bubble) {
                const mat = new THREE.SpriteMaterial({ transparent: true, opacity: 0 });
                bubble = new THREE.Sprite(mat);
                bubble.name = 'msgBubble';
                bubble.userData.senderId = shadow.userData.id;
                bubble.center.set(0.5, 0);
                bubble.position.y = 2.3;
                shadow.add(bubble);
            }

            if (bubble.userData.lastText === text) return;

            // 'The Mystery hook': Keep 3D messages short and intriguing
            let displayPingText = text;
            if (text && text.length > 14) {
                displayPingText = text.substring(0, 11) + "...";
            }

            const { tex } = createMessageTexture(displayPingText);
            if (bubble.material.map) bubble.material.map.dispose();
            bubble.material.map = tex;

            // Revert to Classic Compact Scale
            bubble.scale.set(1.8, 0.9, 1);
            bubble.position.y = 1.85;

            bubble.userData.lastText = text;

            // Sync with Firestore: convert timestamp to millis, fallback to Date.now()
            let time = Date.now();
            if (createdAt) {
                if (typeof createdAt.toMillis === 'function') time = createdAt.toMillis();
                else if (createdAt.seconds) time = createdAt.seconds * 1000;
                else time = createdAt;
            }
            bubble.userData.createdAt = time;
            bubble.userData.shouldShow = true;
            bubble.userData.isBurningOut = false; // Reset if new message arrives
            bubble.visible = true;
        };

        const syncVisibility = (newMode) => {
            if (!scene) return;
            const isForestRoom = (newMode === 'public' || newMode === 'private');
            const showFire = (newMode !== 'landing');

            // Hide/Show Forest elements
            if (forestContainer) {
                forestContainer.visible = isForestRoom;
            }
            if (shadowsGroup) shadowsGroup.visible = isForestRoom;
            if (ground) ground.visible = isForestRoom;
            if (groundGlow) groundGlow.visible = isForestRoom;

            // Hide/Show Fire components
            if (particles) particles.visible = showFire;
            if (bodyEmbers) bodyEmbers.visible = showFire;
            if (logs) logs.visible = showFire;
            if (fireLight) fireLight.visible = showFire;
            const coreObj = scene.getObjectByName('coreHeat');
            if (coreObj) coreObj.visible = showFire;

            // Atmosphere (now part of forestContainer)
            if (ambientLight) ambientLight.visible = isForestRoom;


            // Fog: only if forest
            scene.fog = isForestRoom ? new THREE.FogExp2(0x05080a, 0.05) : null;
        };


        const initThree = () => {
            const w = container.value?.clientWidth || window.innerWidth;
            const h = container.value?.clientHeight || window.innerHeight;
            scene = new THREE.Scene();
            // Fog set dynamically in mode watcher

            camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
            camera.position.set(0, 4.0, 10.0); // Move back a bit
            camera.lookAt(0, 1.0, 0);

            // Audio Listener (AudioController instantiation at the end of initThree handles initialization)
            const listener = new THREE.AudioListener();
            camera.add(listener);

            renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(w, h);
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setClearColor(0x000000, 0); // Absolute transparency
            if (container.value) container.value.appendChild(renderer.domElement);

            fireLight = new THREE.PointLight(0xffaa00, 2.5, 20);
            fireLight.position.set(0, 1.5, 0);
            scene.add(fireLight);

            ambientLight = new THREE.AmbientLight(0x221100, 0.6);
            scene.add(ambientLight);

            // -- LOGS (Detailed and dark) --
            logs = new THREE.Group();
            const logGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8);
            const logMat = new THREE.MeshStandardMaterial({ color: 0x1a1212, roughness: 1.0 });
            const logPositions = [
                { r: [0, 0, Math.PI / 2.2], y: Math.PI / 4, p: [0, 0.1, 0] },
                { r: [0, 0, Math.PI / 1.8], y: -Math.PI / 4, p: [0, 0.1, 0] },
                { r: [Math.PI / 2, 0, 0], y: 0, p: [0.1, 0.2, 0] },
                { r: [Math.PI / 2.1, 0, 0.2], y: Math.PI / 2, p: [-0.1, 0.15, 0] },
                { r: [0.3, 0, Math.PI / 2], y: 1.1, p: [0, 0.25, 0.1] }
            ];
            logPositions.forEach(cfg => {
                const l = new THREE.Mesh(logGeo, logMat);
                l.rotation.set(...cfg.r);
                l.rotation.y += cfg.y;
                l.position.set(...cfg.p);
                logs.add(l);
            });
            scene.add(logs);

            // -- CORE HEAT (Bright center) --
            const coreGeo = new THREE.IcosahedronGeometry(0.3, 1);
            const coreMat = new THREE.MeshBasicMaterial({
                color: 0xff4400,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending
            });
            const core = new THREE.Mesh(coreGeo, coreMat);
            core.position.y = 0.3;
            core.name = 'coreHeat';
            scene.add(core);

            // -- FOREST FLOOR (Dark, earthy) --
            const groundGeo = new THREE.PlaneGeometry(100, 100);
            const groundMat = new THREE.MeshStandardMaterial({
                color: 0x020402, // Near-black mud/earth
                roughness: 1.0,
                metalness: 0.0
            });
            ground = new THREE.Mesh(groundGeo, groundMat);
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = 0;
            ground.name = 'ground';
            scene.add(ground);

            // -- GROUND GLOW (Subtle additive layer) --
            const glowGeo = new THREE.CircleGeometry(5, 32);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0x442200,
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending
            });
            groundGlow = new THREE.Mesh(glowGeo, glowMat);
            groundGlow.rotation.x = -Math.PI / 2;
            groundGlow.position.y = 0.02;
            groundGlow.name = 'groundGlow';
            scene.add(groundGlow);

            shadowsGroup = new THREE.Group();
            scene.add(shadowsGroup);

            // Particle Texture
            const canvas = document.createElement('canvas');
            canvas.width = 32; canvas.height = 32;
            const ctx = canvas.getContext('2d');
            const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 32, 32);
            const texture = new THREE.CanvasTexture(canvas);

            const particleGeo = new THREE.BufferGeometry();
            const positions = new Float32Array(PARTICLE_COUNT * 3);
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                positions[i * 3 + 1] = -500;
            }
            particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const particleMat = new THREE.PointsMaterial({
                color: 0xff6600,
                size: 0.25,
                transparent: true,
                opacity: 0.8,
                map: texture,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            particles = new THREE.Points(particleGeo, particleMat);
            scene.add(particles);

            // -- BODY EMBERS (Larger, more atmospheric) --
            const bodyEmberGeo = new THREE.BufferGeometry();
            const bodyPos = new Float32Array(100 * 3);
            for (let i = 0; i < 100; i++) bodyPos[i * 3 + 1] = -500;
            bodyEmberGeo.setAttribute('position', new THREE.BufferAttribute(bodyPos, 3));
            const bodyEmberMat = new THREE.PointsMaterial({
                color: 0xff4400,
                size: 0.8,
                transparent: true,
                opacity: 0.3,
                map: texture,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            bodyEmbers = new THREE.Points(bodyEmberGeo, bodyEmberMat);
            bodyEmbers.name = 'bodyEmbers';
            scene.add(bodyEmbers);

            // Setup the forest based on the initial seed
            setupForest(props.seed);

            // Set initial visibility based on mode
            syncVisibility(props.mode);

            audioController = new AudioController(listener, () => {
                emit('ready');
            });
            audioController.setMuted(props.isMuted);
            emit('audio-ready', audioController);
            isLoaded = true;
        };

        class AudioController {
            constructor(listener, onReady) {
                const manager = new THREE.LoadingManager();
                manager.onLoad = () => {
                    if (onReady) onReady();
                };
                manager.onError = (url) => {
                    console.warn("Audio failed to load:", url);
                    if (onReady) onReady(); // Fallback so we don't hang
                };

                const loader = new THREE.AudioLoader(manager);
                this.listener = listener;
                this.isMuted = false;
                this.sounds = {};

                // 1. Bonfire (Spatial)
                this.sounds.bonfire = new THREE.PositionalAudio(listener);
                loader.load('assets/bonfire.mp3', (buffer) => {
                    this.sounds.bonfire.setBuffer(buffer);
                    this.sounds.bonfire.setLoop(true);
                    this.sounds.bonfire.setVolume(0); // Start silent for reveal
                    this.sounds.bonfire.setRefDistance(4); // Increased for better range
                    this.sounds.bonfire.play();
                    this.updateBonfireVolume(0);
                });

                // 2. Night Ambience (Stereo)
                this.sounds.ambience = new THREE.Audio(listener);
                loader.load('assets/night_ambience.mp3', (buffer) => {
                    this.sounds.ambience.setBuffer(buffer);
                    this.sounds.ambience.setLoop(true);
                    this.sounds.ambience.setVolume(0); // Start silent
                    this.sounds.ambience.play();
                });

                // 3. Fire Burns (One-shot)
                this.sounds.burn = new THREE.Audio(listener);
                loader.load('assets/fire_burns.mp3', (buffer) => {
                    this.sounds.burn.setBuffer(buffer);
                    this.sounds.burn.setVolume(0.8);
                });
                // 4. Random Life (Owl, Cricket)
                this.lifeSounds = ['owl', 'cricket'];
                this.lifeSounds.forEach(name => {
                    this.sounds[name] = new THREE.Audio(listener);
                    loader.load(`assets/${name}.mp3`, (buffer) => {
                        this.sounds[name].setBuffer(buffer);
                        this.sounds[name].setVolume(0.4);
                    });
                });

                // 5. Arrival Notification
                this.sounds.notif = new THREE.Audio(listener);
                loader.load('assets/notif.mp3', (buffer) => {
                    this.sounds.notif.setBuffer(buffer);
                    this.sounds.notif.setVolume(0.5);
                });

                // Start life timer
                this.lifeTimer = setInterval(() => this.playRandomLife(), 15000 + Math.random() * 30000);
            }

            updateBonfireVolume(fuelLevel) {
                if (!this.sounds.bonfire || !this.sounds.ambience) return;

                // Base thresholds
                const minVol = 0.4;
                const maxVol = 1.0;

                // Calculation: consistent base + growth factor
                let targetVol = minVol + (fuelLevel * 0.5);
                targetVol = Math.min(maxVol, Math.max(minVol, targetVol));

                if (this.isMuted) {
                    this.sounds.bonfire.setVolume(0);
                    this.sounds.ambience.setVolume(0);
                } else {
                    this.sounds.bonfire.setVolume(targetVol);
                    this.sounds.ambience.setVolume(0.5); // Lower background a bit
                }
            }

            playBurn() {
                if (this.isMuted || !this.sounds.burn || !this.sounds.burn.buffer) return;
                if (this.sounds.burn.isPlaying) this.sounds.burn.stop();
                this.sounds.burn.play();
            }

            playArrival() {
                if (this.isMuted || !this.sounds.notif || !this.sounds.notif.buffer) return;
                if (this.sounds.notif.isPlaying) this.sounds.notif.stop();
                this.sounds.notif.play();
            }

            playRandomLife() {
                if (this.isMuted || !this.sounds.ambience) return; // Wait for assets
                const name = this.lifeSounds[Math.floor(Math.random() * this.lifeSounds.length)];
                const s = this.sounds[name];
                if (s && s.buffer && !s.isPlaying) {
                    s.play();
                }
            }

            setMuted(muted) {
                this.isMuted = muted;
                if (this.listener) {
                    this.listener.setMasterVolume(muted ? 0 : 1);
                }
            }
        }

        // -- Deterministic World Generation --
        const seededRandom = () => {
            _seed = (_seed * 9301 + 49297) % 233280;
            return _seed / 233280;
        };

        const setupForest = (targetSeed) => {
            _seed = targetSeed || 12345;

            // Cleanup previous forest
            if (forestContainer) {
                scene.remove(forestContainer);
                forestContainer.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                        else child.material.dispose();
                    }
                });
            }

            // Cleanup previous sky
            if (skyContainer) {
                scene.remove(skyContainer);
                skyContainer.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                        else child.material.dispose();
                    }
                });
            }

            forestContainer = new THREE.Group();
            forestContainer.name = 'forestContainer';
            scene.add(forestContainer);

            skyContainer = new THREE.Group();
            skyContainer.name = 'skyContainer';
            scene.add(skyContainer);

            if (!foliageMat) {
                foliageMat = new THREE.MeshStandardMaterial({
                    color: 0x011001, // Desaturated Charcoal Green
                    emissive: 0x110800, // Dimmer heat glow
                    emissiveIntensity: 0.1,
                    roughness: 1.0,
                    side: THREE.DoubleSide
                });
                foliageMat.name = 'foliageMat';
            }

            if (!trunkMat) {
                trunkMat = new THREE.MeshStandardMaterial({
                    color: 0x0a0500, // Dark Charcoal Brown
                    emissive: 0x110800,
                    emissiveIntensity: 0.1,
                    roughness: 1.0,
                    side: THREE.DoubleSide
                });
                trunkMat.name = 'trunkMat';
            }

            // -- SILHOUETTED FOREST --
            const treeGroup = new THREE.Group();
            treeGroup.name = 'treeGroup';
            for (let i = 0; i < 22; i++) {
                let angle = (i / 22) * Math.PI * 2;
                if (angle > 0.8 && angle < 2.3) continue;
                const dist = 9 + seededRandom() * 8;
                const tree = createTree(foliageMat, trunkMat);
                tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
                const s = 1.6 + seededRandom() * 2;
                tree.scale.set(s, s, s);
                tree.rotation.y = seededRandom() * Math.PI;
                treeGroup.add(tree);

                // Add grass clump at base
                const grass = createGrass(foliageMat);
                grass.position.copy(tree.position);
                grass.scale.setScalar(s * 0.5);
                grass.name = 'grassClump';
                forestContainer.add(grass);
            }
            forestContainer.add(treeGroup);

            // -- BOULDERS --
            const bouldersGroup = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const rockGeo = new THREE.IcosahedronGeometry(0.3 + seededRandom() * 0.4, 0);
                const rock = new THREE.Mesh(rockGeo, trunkMat);
                const angle = seededRandom() * Math.PI * 2;
                const dist = 3.5 + seededRandom() * 2;
                rock.position.set(Math.cos(angle) * dist, 0.1, Math.sin(angle) * dist);
                rock.rotation.set(seededRandom(), seededRandom(), seededRandom());
                bouldersGroup.add(rock);
            }
            forestContainer.add(bouldersGroup);

            // -- LUSH FOREST FLOOR (Rebalanced Density) --
            // 1. Scattered Grass Clumps (Pruned)
            for (let i = 0; i < 320; i++) {
                const angle = seededRandom() * Math.PI * 2;
                if (angle > 1.2 && angle < 1.9) continue;

                const dist = 6 + seededRandom() * 22;
                const grass = createGrass(foliageMat);
                grass.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
                const s = 0.4 + seededRandom() * 1.3;
                grass.scale.setScalar(s);
                grass.rotation.y = seededRandom() * Math.PI;
                grass.name = 'grassClump';
                forestContainer.add(grass);
            }

            // 2. Moss Patches (Moodier)
            const mossMat = new THREE.MeshBasicMaterial({
                color: 0x011201, // Deep charcoal moss
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending
            });
            const mossGeo = new THREE.CircleGeometry(1, 12);
            for (let i = 0; i < 60; i++) {
                const angle = seededRandom() * Math.PI * 2;
                const dist = 5 + seededRandom() * 20;
                const moss = new THREE.Mesh(mossGeo, mossMat);
                moss.position.set(Math.cos(angle) * dist, 0.01, Math.sin(angle) * dist);
                moss.rotation.x = -Math.PI / 2;
                moss.scale.setScalar(0.8 + seededRandom() * 2.5);
                moss.name = 'mossPatch';
                forestContainer.add(moss);
            }

            // 3. Forest Litter (Increased earthy contrast)
            const needleGeo = new THREE.PlaneGeometry(0.18, 0.02);
            const needleMat = new THREE.MeshBasicMaterial({ color: 0x140a00, transparent: true, opacity: 0.7 });
            for (let i = 0; i < 300; i++) {
                const angle = seededRandom() * Math.PI * 2;
                const dist = 4 + seededRandom() * 18;
                const needle = new THREE.Mesh(needleGeo, needleMat);
                needle.position.set(Math.cos(angle) * dist, 0.015, Math.sin(angle) * dist);
                needle.rotation.set(-Math.PI / 2, 0, seededRandom() * Math.PI);
                needle.name = 'needleLitter';
                forestContainer.add(needle);
            }

            // -- GROUND MIST (Atmospheric Depth) --
            const mistGeo = new THREE.BufferGeometry();
            const mistPos = new Float32Array(50 * 3);
            for (let i = 0; i < 50; i++) {
                const angle = seededRandom() * Math.PI * 2;
                const dist = 6 + seededRandom() * 15;
                mistPos[i * 3] = Math.cos(angle) * dist;
                mistPos[i * 3 + 1] = 0.1 + seededRandom() * 0.5;
                mistPos[i * 3 + 2] = Math.sin(angle) * dist;
            }
            mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
            const mistMat = new THREE.PointsMaterial({
                color: 0x445566,
                size: 2.5,
                transparent: true,
                opacity: 0.1,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const groundMist = new THREE.Points(mistGeo, mistMat);
            groundMist.name = 'groundMist';
            forestContainer.add(groundMist);

            // -- NIGHT SKY (Stars & Moon) --
            const starGeo = new THREE.BufferGeometry();
            const starPos = new Float32Array(400 * 3);
            for (let i = 0; i < 400; i++) {
                const r = 40 + seededRandom() * 20;
                const theta = seededRandom() * Math.PI * 2;
                const phi = seededRandom() * Math.PI * 0.5; // Top half only
                starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
                starPos[i * 3 + 1] = r * Math.cos(phi) + 5;
                starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            }
            starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
            const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.8 });
            stars = new THREE.Points(starGeo, starMat);
            skyContainer.add(stars);

            // -- MOON (Classic Sphere) --
            moonGroup = new THREE.Group();
            const moonGeo = new THREE.SphereGeometry(2.5, 32, 32);
            const moonMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // Pure white brightness
            const moon = new THREE.Mesh(moonGeo, moonMat);
            moonGroup.add(moon);

            // Halo (Soft glow)
            const haloGeo = new THREE.CircleGeometry(4.0, 32);
            const haloMat = new THREE.MeshBasicMaterial({
                color: 0x88ccff,
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending
            });
            const halo = new THREE.Mesh(haloGeo, haloMat);
            halo.position.z = -0.1;
            moonGroup.add(halo);
            skyContainer.add(moonGroup);

            // Initial positioning to prevent it starting at bonfire (0,0,0)
            const celestialTime = Date.now() * 0.000005;
            const xProgress = Math.cos(celestialTime);
            moonGroup.position.x = xProgress * 50;
            const yCurve = 1.0 - (xProgress * xProgress);
            moonGroup.position.y = 3 + yCurve * 8;
            moonGroup.position.z = -50;

            // -- FIREFLIES --
            const fireflyGeo = new THREE.BufferGeometry();
            const ffPos = new Float32Array(30 * 3);
            const ffData = [];
            for (let i = 0; i < 30; i++) {
                const angle = seededRandom() * Math.PI * 2;
                const dist = 4 + seededRandom() * 8;
                ffPos[i * 3] = Math.cos(angle) * dist;
                ffPos[i * 3 + 1] = 0.5 + seededRandom() * 3;
                ffPos[i * 3 + 2] = Math.sin(angle) * dist;
                ffData.push({ offset: seededRandom() * 100, baseY: ffPos[i * 3 + 1] });
            }
            fireflyGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
            const fireflyMat = new THREE.PointsMaterial({ color: 0xffcc00, size: 0.15, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
            fireflies = new THREE.Points(fireflyGeo, fireflyMat);
            fireflies.userData.data = ffData;
            forestContainer.add(fireflies);


            // Sync visibility for the new container
            syncVisibility(props.mode);
        };

        const createTree = (fMat, tMat) => {
            const group = new THREE.Group();
            const trunkGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 8);
            const trunk = new THREE.Mesh(trunkGeo, tMat);
            trunk.position.y = 0.5;
            group.add(trunk);

            // Foliage (3 Cones)
            for (let i = 0; i < 3; i++) {
                const coneGeo = new THREE.ConeGeometry(1.5 - (i * 0.3), 2.5, 8);
                const cone = new THREE.Mesh(coneGeo, fMat);
                cone.position.y = 2 + (i * 1.5);
                group.add(cone);
            }
            return group;
        };

        const createGrass = (mat) => {
            const group = new THREE.Group();
            const geo = new THREE.PlaneGeometry(0.8, 0.6);
            for (let i = 0; i < 5; i++) {
                const p = new THREE.Mesh(geo, mat);
                const angle = (i / 5) * Math.PI * 2;
                const dist = 0.4 + seededRandom() * 0.5;

                p.position.set(Math.cos(angle) * dist, 0.3, Math.sin(angle) * dist);
                p.rotation.y = angle + Math.PI / 2;
                p.rotation.x = -0.2 - seededRandom() * 0.3; // Tilt outward
                group.add(p);
            }
            return group;
        };

        const getGlyphShape = (id) => {
            const glyphs = ['circle', 'square', 'triangle', 'x', 'plus', 'diamond', 'hex', 'pent', 'bolt', 'heart', 'star', 'moon', 'dot', 'bar', 'ring'];

            // 1. Direct check against the participant data
            const p = props.participants ? props.participants.find(p => p.id === id) : null;
            if (p && p.glyphIdx !== undefined) {
                const idx = parseInt(p.glyphIdx);
                if (idx >= 0 && idx < glyphs.length) return glyphs[idx];
            }

            // 2. Fallback to a deterministic hash of the ID
            let hash = 0;
            for (let i = 0; i < id.length; i++) hash += id.charCodeAt(i);
            return glyphs[hash % glyphs.length];
        };

        const getGlyphGeometry = (shapeName) => {
            const s = 0.22;
            switch (shapeName) {
                case 'circle': return new THREE.CircleGeometry(s / 2, 32);
                case 'dot': return new THREE.CircleGeometry(s / 6, 32);
                case 'ring': return new THREE.RingGeometry(s / 4, s / 2, 32);
                case 'square': return new THREE.PlaneGeometry(s, s);
                case 'bar': return new THREE.PlaneGeometry(s, s / 4);
                case 'triangle': return new THREE.CircleGeometry(s / 2, 3, Math.PI / 2);
                case 'diamond': return new THREE.CircleGeometry(s / 2, 4, Math.PI / 2);
                case 'hex': return new THREE.CircleGeometry(s / 2, 6, Math.PI / 2);
                case 'pent': return new THREE.CircleGeometry(s / 2, 5, Math.PI / 2);
                case 'plus': {
                    const shape = new THREE.Shape();
                    const w = s / 2; const t = s / 6;
                    shape.moveTo(-t / 2, w / 2); shape.lineTo(t / 2, w / 2); shape.lineTo(t / 2, t / 2);
                    shape.lineTo(w / 2, t / 2); shape.lineTo(w / 2, -t / 2); shape.lineTo(t / 2, -t / 2);
                    shape.lineTo(t / 2, -w / 2); shape.lineTo(-t / 2, -w / 2); shape.lineTo(-t / 2, -t / 2);
                    shape.lineTo(-w / 2, -t / 2); shape.lineTo(-w / 2, t / 2); shape.lineTo(-t / 2, t / 2);
                    return new THREE.ShapeGeometry(shape);
                }
                case 'x': {
                    const shape = new THREE.Shape();
                    const w = s / 2; const t = s / 8;
                    const d = w * 0.707; const td = t * 0.707; // sin(45)
                    shape.moveTo(-td, 0); shape.lineTo(-d, d - td); shape.lineTo(-d + td, d);
                    shape.lineTo(0, td); shape.lineTo(d - td, d); shape.lineTo(d, d - td);
                    shape.lineTo(td, 0); shape.lineTo(d, -d + td); shape.lineTo(d - td, -d);
                    shape.lineTo(0, -td); shape.lineTo(-d + td, -d); shape.lineTo(-d, -d + td);
                    return new THREE.ShapeGeometry(shape);
                }
                case 'star': {
                    const shape = new THREE.Shape();
                    const outer = s / 2; const inner = s / 4.5;
                    for (let i = 0; i < 10; i++) {
                        const r = i % 2 === 0 ? outer : inner;
                        const angle = (i / 10) * Math.PI * 2 - (Math.PI / 2); // Start at bottom, rotate after
                        if (i === 0) shape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
                        else shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
                    }
                    const geo = new THREE.ShapeGeometry(shape);
                    geo.rotateZ(Math.PI); // Flip star to point UP
                    return geo;
                }
                case 'heart': {
                    const shape = new THREE.Shape();
                    const x = 0; const y = 0; const h = s / 1.5;
                    shape.moveTo(x, y + h / 4);
                    shape.bezierCurveTo(x, y + h / 4, x - h / 2, y + h / 2, x - h / 2, y);
                    shape.bezierCurveTo(x - h / 2, y - h / 2, x, y - h / 2, x, y - h / 2);
                    shape.bezierCurveTo(x, y - h / 2, x + h / 2, y - h / 2, x + h / 2, y);
                    shape.bezierCurveTo(x + h / 2, y + h / 2, x, y + h / 4, x, y + h / 4);
                    return new THREE.ShapeGeometry(shape);
                }
                case 'bolt': {
                    const shape = new THREE.Shape();
                    // Points mapped from CSS: (50% 0%, 90% 20%, 45% 45%, 80% 55%, 25% 100%, 45% 55%, 15% 45%)
                    shape.moveTo(0, s / 2);
                    shape.lineTo(s * 0.4, s * 0.3);
                    shape.lineTo(-s * 0.05, s * 0.05);
                    shape.lineTo(s * 0.3, -s * 0.05);
                    shape.lineTo(-s * 0.25, -s / 2);
                    shape.lineTo(-s * 0.05, -s * 0.05);
                    shape.lineTo(-s * 0.35, s * 0.05);
                    return new THREE.ShapeGeometry(shape);
                }
                case 'moon': {
                    const shape = new THREE.Shape();
                    shape.absarc(0, 0, s / 2, 0, Math.PI * 2, false);
                    const hole = new THREE.Path();
                    hole.absarc(s / 4, s / 4, s / 2, 0, Math.PI * 2, true);
                    shape.holes.push(hole);
                    return new THREE.ShapeGeometry(shape);
                }
                default: return new THREE.PlaneGeometry(s, s);
            }
        };

        const createBubbleTexture = (id) => {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Outer Glow
            ctx.shadowBlur = 15;
            ctx.shadowColor = 'rgba(255, 190, 11, 0.3)';

            // Draw bubble base (Dark Charcoal)
            ctx.fillStyle = 'rgba(15, 15, 15, 0.95)';
            ctx.beginPath();
            ctx.arc(64, 50, 45, 0, Math.PI * 2);
            ctx.fill();

            // Bubble "tail"
            ctx.beginPath();
            ctx.moveTo(64, 95); ctx.lineTo(55, 115); ctx.lineTo(75, 95);
            ctx.fill();

            // Reset shadow for glyph
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffbe0b';

            // Draw Glyph (Glowing Gold)
            const shapeName = getGlyphShape(id);
            ctx.strokeStyle = '#ffbe0b';
            ctx.fillStyle = '#ffbe0b';
            ctx.lineWidth = 8; // Bold for 3D visibility
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            const s = 34; // Slightly larger
            const ox = 64; const oy = 50;

            if (shapeName === 'circle' || shapeName === 'ring' || shapeName === 'dot') {
                ctx.arc(ox, oy, s / 2, 0, Math.PI * 2);
                if (shapeName === 'ring') ctx.stroke(); else ctx.fill();
            } else if (shapeName === 'square' || shapeName === 'bar') {
                const h = shapeName === 'bar' ? s / 3 : s;
                ctx.rect(ox - s / 2, oy - h / 2, s, h);
                ctx.fill(); // Fill for better visibility
            } else if (shapeName === 'triangle') {
                ctx.moveTo(ox, oy - s / 2); ctx.lineTo(ox - s / 2, oy + s / 2); ctx.lineTo(ox + s / 2, oy + s / 2); ctx.closePath();
                ctx.stroke();
            } else if (shapeName === 'hex' || shapeName === 'pent' || shapeName === 'diamond') {
                const sides = shapeName === 'hex' ? 6 : (shapeName === 'pent' ? 5 : 4);
                ctx.moveTo(ox + (s / 2) * Math.cos(0), oy + (s / 2) * Math.sin(0));
                for (let i = 1; i <= sides; i++) {
                    ctx.lineTo(ox + (s / 2) * Math.cos(i * 2 * Math.PI / sides - Math.PI / 2), oy + (s / 2) * Math.sin(i * 2 * Math.PI / sides - Math.PI / 2));
                }
                ctx.closePath();
                ctx.stroke();
            } else if (shapeName === 'plus' || shapeName === 'x') {
                const ang = shapeName === 'x' ? Math.PI / 4 : 0;
                ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang);
                ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0); ctx.moveTo(0, -s / 2); ctx.lineTo(0, s / 2);
                ctx.stroke(); ctx.restore();
            } else {
                // Star or Star-like default
                for (let i = 0; i < 5; i++) {
                    ctx.lineTo(ox + (s / 2) * Math.cos((i * 4 * Math.PI / 5) - Math.PI / 2), oy + (s / 2) * Math.sin((i * 4 * Math.PI / 5) - Math.PI / 2));
                }
                ctx.closePath();
                ctx.stroke();
            }

            const tex = new THREE.CanvasTexture(canvas);
            return tex;
        };

        const createShadowEntity = (id) => {
            const group = new THREE.Group();

            // Silhouette (Vertical 3D Monolith)
            const bodyGeo = new THREE.BoxGeometry(0.5, 1.4, 0.4);
            const bodyMat = new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0.8
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat.clone());
            body.name = 'body';
            body.position.y = 0.7; // Sit on ground
            group.add(body);

            // Ground Shadow (Base)
            const baseGeo = new THREE.CircleGeometry(0.5, 32);
            const baseMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
            const base = new THREE.Mesh(baseGeo, baseMat.clone());
            base.name = 'base';
            base.rotation.x = -Math.PI / 2;
            group.add(base);

            // Glyph Face (On front of box)
            const shapeName = getGlyphShape(id);
            const faceGeo = getGlyphGeometry(shapeName);
            const faceMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide
            });
            const face = new THREE.Mesh(faceGeo, faceMat.clone());
            face.name = 'face';
            face.userData.shapeName = shapeName;
            face.position.y = 1.1; // Head height
            face.position.z = 0.201; // Just in front of the box face
            group.add(face);

            // Double the face on the back
            const faceBack = new THREE.Mesh(faceGeo, faceMat.clone());
            faceBack.name = 'faceBack';
            faceBack.position.y = 1.1;
            faceBack.position.z = -0.201;
            faceBack.rotation.y = Math.PI;
            group.add(faceBack);

            // Back Glow (Optional halo)
            const glowGeo = new THREE.PlaneGeometry(0.6, 1.5);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.05,
                side: THREE.DoubleSide
            });
            const glow = new THREE.Mesh(glowGeo, glowMat.clone());
            glow.name = 'glow';
            glow.position.y = 0.7;
            glow.position.z = -0.01;
            group.add(glow);

            // Store metadata for animations
            group.userData = {
                id,
                seed: Math.random() * 10,
                progress: 0, // 0 to 1 (0 = submerged, 1 = standing)
                isLeaving: false
            };

            // Start submerged
            group.position.y = -1.5;
            group.scale.y = 0.5;

            // Thought Bubble (Arrival Notification)
            const bubbleTex = createBubbleTexture(id);
            const bubbleMat = new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, opacity: 0 });
            const bubble = new THREE.Sprite(bubbleMat);
            bubble.name = 'bubble';
            bubble.scale.setScalar(0);
            bubble.position.y = 1.8;
            bubble.visible = false;
            group.add(bubble);


            return group;
        };

        const updateShadows = (userDatas) => {
            if (!shadowsGroup) return;

            // Target IDs: Don't show ghost on landing
            if (props.mode === 'landing') {
                shadowsGroup.children.forEach(c => c.userData.isLeaving = true);
                return;
            }
            const datas = userDatas || [];
            if (datas.length === 0) {
                shadowsGroup.children.forEach(c => c.userData.isLeaving = true);
                return;
            }

            // --- VETERAN LOGIC: Identify New Arrivals ---
            let currentNewestTime = 0;
            let newestId = null;
            const getMs = (t) => t ? (t.toMillis ? t.toMillis() : t) : 0;
            datas.forEach(d => {
                const time = getMs(d.joinedAt);
                if (time > currentNewestTime) {
                    currentNewestTime = time;
                    newestId = d.id;
                }
            });

            // Trigger only if we already had a "newest" and now there is a "newer"
            const isNewArrival = lastKnownNewestTime > 0 && currentNewestTime > lastKnownNewestTime;
            let arrivalAudioPlayed = false;

            if (isNewArrival) {
                lastKnownNewestTime = currentNewestTime;
            } else if (lastKnownNewestTime === 0 && currentNewestTime > 0) {
                // Initialize on first valid sync without triggering
                lastKnownNewestTime = currentNewestTime;
            }

            const ids = datas.map(d => d.id);

            // Clear entities that are no longer present (Flag them for "Sinking")
            shadowsGroup.children.forEach(child => {
                if (child.userData.id && !ids.includes(child.userData.id)) {
                    child.userData.isLeaving = true;
                }
            });

            datas.forEach((data) => {
                const id = data.id;

                // DETERMINISTIC POS: Always recalculate everything to ensure total sync across all clients
                let hash = 0;
                const seedVal = String(props.seed || 0);
                const joinVal = String(data.joinedAt || '');
                const seedStr = `S:${seedVal}|U:${id}|J:${joinVal}`;
                for (let i = 0; i < seedStr.length; i++) hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);

                const r1 = (Math.abs(hash) % 100) / 100;
                const r2 = (Math.abs(hash >> 2) % 100) / 100;
                const angle = r1 * Math.PI * 2;
                const radius = 2.0 + (r2 * 1.5);
                const scaleY = 0.9 + (r1 * 0.3);
                const finalY = (scaleY - 1) * 0.7;

                const existing = shadowsGroup.children.find(c => c.userData.id === id);
                if (existing) {
                    existing.userData.isLeaving = false;
                    // Update position + rotation instantly to match hash (fixes all drift)
                    existing.position.set(Math.cos(angle) * radius, finalY, Math.sin(angle) * radius);
                    existing.lookAt(0, 0.7, 0);
                    existing.scale.y = scaleY;

                    // Trigger Veteran Notification
                    if (isNewArrival && getMs(data.joinedAt) < currentNewestTime) {
                        existing.userData.notifiedAt = Date.now();
                        const bubble = existing.children.find(c => c.name === 'bubble');
                        if (bubble) {
                            // Swap bubble texture to newestId's glyph
                            bubble.material.map = createBubbleTexture(newestId);
                            bubble.visible = true;
                        }
                        if (!arrivalAudioPlayed && audioController) {
                            audioController.playArrival();
                            arrivalAudioPlayed = true;
                        }
                    }

                    // SYNC GLYPH: Ensure front and back faces match current sorted state
                    const newShapeName = getGlyphShape(id);
                    const faceFront = existing.children.find(p => p.name === 'face');
                    const faceBack = existing.children.find(p => p.name === 'faceBack');
                    if (faceFront && faceFront.userData.shapeName !== newShapeName) {
                        const newGeo = getGlyphGeometry(newShapeName);
                        faceFront.geometry.dispose();
                        faceFront.geometry = newGeo;
                        faceFront.userData.shapeName = newShapeName;
                        if (faceBack) {
                            faceBack.geometry.dispose();
                            faceBack.geometry = newGeo;
                        }
                    }
                } else {
                    const entity = createShadowEntity(id);
                    entity.scale.y = scaleY;
                    entity.position.set(Math.cos(angle) * radius, finalY, Math.sin(angle) * radius);
                    entity.lookAt(0, 0.7, 0);
                    shadowsGroup.add(entity);

                    // Trigger Veteran Notification for newly created (but not arriving) shadows
                    if (isNewArrival && getMs(data.joinedAt) < currentNewestTime) {
                        entity.userData.notifiedAt = Date.now();
                        const bubble = entity.children.find(c => c.name === 'bubble');
                        if (bubble) {
                            bubble.material.map = createBubbleTexture(newestId);
                            bubble.visible = true;
                        }
                        if (!arrivalAudioPlayed && audioController) {
                            audioController.playArrival();
                            arrivalAudioPlayed = true;
                        }
                    }
                }
            });
        };

        const resetParticle = (posArray, i, initial = false) => {
            const spread = 1.0 + Math.min(fuel * 0.2, 2.0);
            posArray[i * 3] = (Math.random() - 0.5) * spread;
            posArray[i * 3 + 1] = initial ? Math.random() * 4 : Math.random() * 0.2;
            posArray[i * 3 + 2] = (Math.random() - 0.5) * spread;
        };

        const animate = () => {
            if (!renderer || !scene || !camera || !particles) {
                animationId = requestAnimationFrame(animate);
                return;
            }
            animationId = requestAnimationFrame(animate);

            fuel += (targetFuel - fuel) * 0.02;

            // Decays back to baseline (based on user count)
            const currentBaseline = BASELINE_FUEL + Math.min((props.userCount || 0) * 0.4, 1.25);
            if (targetFuel > currentBaseline) {
                targetFuel -= 0.01; // Slower decay
            } else if (targetFuel < currentBaseline) {
                targetFuel = currentBaseline;
            }

            // -- Shadow Entities Transitions --
            if (shadowsGroup) {
                for (let i = shadowsGroup.children.length - 1; i >= 0; i--) {
                    const shadow = shadowsGroup.children[i];
                    const data = shadow.userData;
                    const speed = 0.02;

                    if (data.isLeaving) {
                        data.progress -= speed;
                        if (data.progress <= 0) {
                            shadowsGroup.remove(shadow);
                            continue;
                        }
                    } else if (data.progress < 1 && props.allowRising) {
                        data.progress += speed;
                    }

                    // Height & Scale Interpolation
                    const ease = data.progress * (2 - data.progress); // Simple ease-out
                    shadow.position.y = -1.5 * (1 - ease);

                    // Fade In/Out Glyph
                    shadow.children.forEach(part => {
                        if (part.material) {
                            part.material.opacity = part.name === 'base' ? 0.5 * ease : ease;
                            if (part.name === 'face') part.material.opacity = 0.9 * ease;
                        }
                    });

                    // -- Bubble Animation (Arrival Notifications) --
                    const bubble = shadow.children.find(c => c.name === 'bubble');
                    if (bubble) {
                        const age = Date.now() - (data.notifiedAt || 0);
                        const duration = 5000; // 5 seconds display
                        if (age < duration) {
                            bubble.visible = true;
                            const intro = Math.min(1, age / 600); // 0.6s fade in
                            const outro = Math.min(1, (duration - age) / 800); // 0.8s fade out
                            const alpha = Math.min(intro, outro);

                            bubble.material.opacity = alpha;
                            // Pop effect: starts small, grows slightly past 1, settles
                            const pop = alpha > 0.8 ? 1.0 : alpha * 1.2;
                            bubble.scale.setScalar(pop);
                        } else {
                            bubble.visible = false;
                        }
                    }

                    // -- Speech Bubble Animation (Messages) --
                    const msgBubble = shadow.children.find(c => c.name === 'msgBubble');
                    if (msgBubble && msgBubble.userData.shouldShow) {
                        const now = Date.now();
                        let alpha = 1.0;
                        let floatY = 2.2;
                        const tint = new THREE.Color(1, 1, 1);
                        let isStillInWorld = true;

                        if (msgBubble.userData.isBurningOut) {
                            // CASE A: Forced Evaporation (Data already deleted)
                            const evAge = now - (msgBubble.userData.burnStartedAt || now);
                            const evProgress = Math.min(1, evAge / 4000); // 4s fast-burn
                            alpha = Math.max(0, 1 - evProgress);
                            floatY = 1.9 + (evProgress * 1.5);
                            const pulse = Math.abs(Math.sin(now * 0.015)) * 0.6 + 0.4;
                            tint.setRGB(1, 1 - pulse, 1 - pulse);
                            if (evProgress >= 1) isStillInWorld = false;
                        } else {
                            // CASE B: Natural Lifecycle (Synced with Firestore)
                            const age = now - (msgBubble.userData.createdAt || now);
                            const duration = props.mode === 'private' ? 32000 : 62000;
                            const evStart = duration - 5000;

                            if (age < duration) {
                                if (age < 800) alpha = age / 800; // Fade In
                                else if (age > evStart) {
                                    // Natural Evaporation
                                    const evProgress = (age - evStart) / 5000;
                                    alpha = Math.max(0, 1 - evProgress);
                                    floatY = 1.9 + (evProgress * 0.8);
                                    const pulse = Math.abs(Math.sin(now * 0.01)) * 0.4 + 0.6;
                                    tint.setRGB(1, 1 - (evProgress * pulse), 1 - (evProgress * pulse));
                                } else {
                                    floatY = 1.9;
                                }
                            } else {
                                isStillInWorld = false;
                            }
                        }

                        if (isStillInWorld) {
                            msgBubble.visible = true;
                            msgBubble.material.opacity = alpha;
                            msgBubble.material.color = tint;
                            const s = Math.min(1, alpha * 2);
                            msgBubble.scale.set(1.8 * s, 0.9 * s, 1);
                            msgBubble.position.y = 1.85 + (floatY - 1.9); // Grounded base = 1.85
                        } else {
                            msgBubble.visible = false;
                            msgBubble.userData.shouldShow = false;
                            msgBubble.userData.isBurningOut = false;
                        }
                    }
                }
            }

            const positions = particles.geometry.attributes.position.array;
            const targetActive = Math.min(80 + Math.floor(fuel * 60), PARTICLE_COUNT);

            if (activeParticleCount.value < targetActive) activeParticleCount.value += 5;
            else if (activeParticleCount.value > targetActive) activeParticleCount.value -= 5;

            if (audioController) audioController.updateBonfireVolume(fuel);

            const limit = 8.0 + (fuel * 2.0); // Never cut off
            const burstY = 0.02 + (fuel * 0.012);

            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const isAlive = positions[i * 3 + 1] !== -500;

                if (isAlive) {
                    // Update existing
                    positions[i * 3 + 1] += burstY;
                    positions[i * 3] += Math.sin(Date.now() * 0.001 + i) * 0.003;

                    if (positions[i * 3 + 1] > limit) {
                        positions[i * 3 + 1] = -500; // Natural death
                    }
                } else if (i < activeParticleCount.value) {
                    // Spawn new if needed
                    resetParticle(positions, i, true);
                }
            }
            particles.geometry.attributes.position.needsUpdate = true;

            // -- Body Embers Animation --
            if (bodyEmbers) {
                const bPos = bodyEmbers.geometry.attributes.position.array;
                const bLimit = 3.5 + (fuel * 1.5);

                for (let i = 0; i < 100; i++) {
                    const isAlive = bPos[i * 3 + 1] !== -500;

                    if (isAlive) {
                        bPos[i * 3 + 1] += 0.005 + (fuel * 0.002);
                        bPos[i * 3] += Math.cos(Date.now() * 0.0005 + i) * 0.005;
                        if (bPos[i * 3 + 1] > bLimit) bPos[i * 3 + 1] = -500;
                    } else if (i < 20 + Math.floor(fuel * 40)) { // Spawn limit
                        resetParticle(bPos, i, true);
                    }
                }
                bodyEmbers.geometry.attributes.position.needsUpdate = true;
                bodyEmbers.material.opacity = 0.15 + (fuel * 0.05); // More subtle
            }

            const flicker = Math.sin(Date.now() * 0.008) * 0.2;
            fireLight.intensity = 2.0 + (fuel * 0.6) + flicker; // Capped intensity (from 1.0 fuel)
            fireLight.distance = 25; // Adjusted range (from 40)
            fireLight.color.setHSL(0.08 + (fuel * 0.02), 1, 0.5);

            // Animate Core and Ground Glow
            const core = scene.getObjectByName('coreHeat');
            if (core) {
                core.scale.setScalar(1 + (fuel * 0.2) + (flicker * 0.1));
                core.material.opacity = 0.6 + (fuel * 0.2) + (flicker * 0.1);
            }
            const ground = scene.getObjectByName('groundGlow');
            if (ground) {
                ground.material.opacity = 0.1 + (fuel * 0.3) + (flicker * 0.05);
                ground.scale.setScalar(1 + (fuel * 0.1) + (flicker * 0.02));
            }

            // Animate Tree Glow (Rim lighting & Visual Boost)
            const treeGroup = scene.getObjectByName('treeGroup');
            if (treeGroup && treeGroup.children.length > 0) {
                const tree = treeGroup.children[0];
                const foliage = tree.children[1]; // Cone
                const trunk = tree.children[0];   // Cylinder

                if (foliage && foliage.material) {
                    foliage.material.emissiveIntensity = 0.05 + (fuel * 0.15) + (flicker * 0.05);
                }
                if (trunk && trunk.material) {
                    trunk.material.emissiveIntensity = 0.05 + (fuel * 0.12) + (flicker * 0.05);
                }
            }

            // Animate Fireflies
            if (fireflies) {
                const ffPositions = fireflies.geometry.attributes.position.array;
                const ffData = fireflies.userData.data;
                const time = Date.now() * 0.001;

                for (let i = 0; i < ffData.length; i++) {
                    const d = ffData[i];
                    // Drift
                    const driftX = Math.sin(time * 0.5 + d.offset) * 0.005;
                    const driftZ = Math.cos(time * 0.5 + d.offset) * 0.005;
                    const driftY = Math.sin(time * 0.3 + d.offset) * 0.003;

                    ffPositions[i * 3] += driftX;
                    ffPositions[i * 3 + 1] = d.baseY + driftY;
                    ffPositions[i * 3 + 2] += driftZ;

                    // Simple wrap around if they drift too far out (clearing is ~20m)
                    const distSq = ffPositions[i * 3] ** 2 + ffPositions[i * 3 + 2] ** 2;
                    if (distSq > 400) {
                        ffPositions[i * 3] *= -0.9;
                        ffPositions[i * 3 + 2] *= -0.9;
                    }
                }
                fireflies.geometry.attributes.position.needsUpdate = true;
                fireflies.material.opacity = 0.4 + Math.abs(Math.sin(time + _seed)) * 0.6; // Pulse
            }

            // Animate Shadow Entities (Swaying & Flickering)
            shadowsGroup.children.forEach(entity => {
                const seed = entity.userData.seed;
                entity.rotation.y += Math.sin(Date.now() * 0.001 + seed) * 0.001; // Subtle sway
                entity.scale.setScalar(1 + flicker * 0.05); // Flicker scale
            });


            // Moon Arc (Globally Synchronized Right-to-Left Parabola)
            if (moonGroup) {
                // Use actual time for continuity across page loads/servers
                const celestialTime = Date.now() * 0.000005; // Even slower (approx 60 mins per cycle)
                const xProgress = Math.cos(celestialTime); // -1 to 1

                // Position X: 50 (Right) to -50 (Left)
                moonGroup.position.x = xProgress * 50;

                // Position Y: Curve up peak at 11, down to 3
                const yCurve = 1.0 - (xProgress * xProgress);
                moonGroup.position.y = 3 + yCurve * 8;

                moonGroup.position.z = -50;

                // Billboard to camera: Ensures the halo glow luôn faces the viewer
                moonGroup.lookAt(camera.position);
            }

            renderer.render(scene, camera);
        };

        let initialWidth = 0;
        let initialHeight = 0;

        const onResize = () => {
            if (!container.value || !renderer || !camera) return;
            const w = container.value.clientWidth;
            const h = container.value.clientHeight;

            // -- Height Lock Logic for Mobile --
            // Prevent stretching when the virtual keyboard opens/closes.
            // Only re-render if the width changes or if the height change is major (e.g. orientation).
            const isPortrait = w < h;
            const isMobile = w < 1024;

            if (isMobile && initialWidth === w && Math.abs(initialHeight - h) < 300) {
                // Ignore minor vertical shifts (likely keyboard)
                return;
            }

            initialWidth = w;
            initialHeight = h;

            const aspect = w / h;
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);

            // -- Dynamic Mobile Camera Adjustments --
            const isImmersive = container.value.closest('.immersive-mode');

            if (isPortrait) {
                // Adjust for tall mobile screens: Move camera further back and slightly higher
                // to ensure the entire circle of participants is visible in the frame.
                const zoomFactor = isImmersive ? 14.0 : 12.0;
                const heightFactor = isImmersive ? 5.5 : 5.0;
                camera.position.set(0, heightFactor, zoomFactor);
                camera.lookAt(0, 1.2, 0);
            } else {
                // Desktop/Landscape: Standard majestic view
                const zoomFactor = isImmersive ? 9.0 : 10.0;
                const heightFactor = 4.0;
                camera.position.set(0, heightFactor, zoomFactor);
                camera.lookAt(0, 1.0, 0);
            }
        };

        watch(() => props.mode, (newMode) => {
            syncVisibility(newMode);
            // Trigger resize to fix "squish" when padding-right: 35% is applied/removed
            // Wait for transition to at least start/settle
            setTimeout(onResize, 50);
            setTimeout(onResize, 500);
            setTimeout(onResize, 1000);
            setTimeout(onResize, 1500);
            setTimeout(onResize, 2000);
        }, { immediate: true });

        onResize();

        expose({
            flare: () => {
                targetFuel = Math.min(targetFuel + 1.2, 3.0);
                if (audioController) audioController.playBurn();
            },
            audioController
        });

        return { container };
    }
};
