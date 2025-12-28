import { createApp, ref, onMounted, onUnmounted, computed, watch, nextTick } from "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js";
import * as THREE from "https://unpkg.com/three@0.150.0/build/three.module.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { Campfire } from './campfire.js?v=60';

// --- FIREBASE INIT ---
const firebaseConfig = {
    apiKey: "AIzaSyB2cqQ4JXzV-vrXxfxvD99QODD7KXJZ6qU",
    authDomain: "embers-c1a6a.firebaseapp.com",
    projectId: "embers-c1a6a",
    storageBucket: "embers-c1a6a.firebasestorage.app",
    messagingSenderId: "827914008624",
    appId: "1:827914008624:web:54618105454937951795f5",
    measurementId: "G-ETJDL6W3X3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- USER IDENTITY ---
let userId = sessionStorage.getItem('embers_user_id');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('embers_user_id', userId);
}
let joinedAt = sessionStorage.getItem('embers_joined_at');
if (!joinedAt) {
    joinedAt = Date.now().toString();
    sessionStorage.setItem('embers_joined_at', joinedAt);
}
const sessionJoinedAt = parseInt(joinedAt);

/* --- COMPONENT: Atmosphere --- */
const Atmosphere = {
    template: `
        <div class="atmosphere">
            <div class="noise-overlay"></div>
            <div class="vignette"></div>
            <div class="stars-container" ref="stars"></div>
        </div>
    `,
    setup() {
        const stars = ref(null);
        onMounted(() => {
            if (!stars.value) return;
            for (let i = 0; i < 100; i++) {
                const s = document.createElement('div');
                s.className = 'star';
                s.style.width = Math.random() * 2 + 'px';
                s.style.height = s.style.width;
                s.style.top = Math.random() * 100 + '%';
                s.style.left = Math.random() * 100 + '%';
                s.style.setProperty('--duration', 2 + Math.random() * 3 + 's');
                stars.value.appendChild(s);
            }
        });
        return { stars };
    }
};

/* --- COMPONENT: Loading Overlay --- */
const LoadingOverlay = {
    template: `
        <div class="loading-overlay">
            <div class="loader-ember"></div>
            <div class="loader-text">{{ randomPoem }}</div>
        </div>
    `,
    setup() {
        const poems = [
            "We are but sparks in the void.",
            "To burn is to exist.",
            "Silence ends where the fire begins.",
            "Shadows dance for those who watch.",
            "The flame remembers what was lost."
        ];

        // Inherit from static loader if present to avoid "blink"
        const staticNode = document.getElementById('loader-text-node');
        const randomPoem = ref(staticNode ? staticNode.innerText : poems[Math.floor(Math.random() * poems.length)]);

        return { randomPoem };
    },
};

/* --- COMPONENT: Chat Interface --- */
const Chat = {
    props: ['mode', 'roomCode', 'activeUserIds', 'participants'],
    template: `
        <div class="view-container chat-layout" :class="{ 'is-private': mode === 'private' }">
            <div class="glass-panel">
                <div class="chat-header">
                    <button class="icon-btn back-btn" @click="$emit('back')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                        <span>Back</span>
                    </button>
                    <div class="room-info">
                        <span class="mode-label">{{ mode === 'public' ? 'Public Fire' : 'Private Room' }}</span>
                        <span v-if="mode === 'private'" class="room-code">{{ roomCode }}</span>
                    </div>
                    <button class="icon-btn immersive-toggle" @click="$emit('toggle-immersive')" title="Enter Immersive Mode">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                        </svg>
                    </button>
                </div>

                <div class="messages-area" ref="msgArea">
                    <div class="fade-mask-top"></div>
                    <transition-group name="list-move" tag="div" class="msg-list">
                        <div v-for="msg in messages" :key="msg.id" class="message-row" :class="{ 'own-row': msg.senderId === myId }">
                            <div v-if="msg.senderId !== myId" class="user-avatar" :class="getUserGlyph(msg)"></div>
                            <div class="message-bubble" :class="[msg.phase, { 'own': msg.senderId === myId }]">
                                <span class="msg-text">{{ msg.text }}</span>
                            </div>
                            <div v-if="msg.senderId === myId" class="user-avatar" :class="getUserGlyph(msg)"></div>
                        </div>
                    </transition-group>
                    <div class="fade-mask-bottom"></div>
                </div>

                <div class="input-area">
                    <div class="input-capsule" :class="{ 'focused': isFocused, 'disabled': hasActiveMessage }">
                        <input 
                            v-model="inputText" 
                            @keyup.enter="sendMessage" 
                            @focus="isFocused = true"
                            @blur="isFocused = false"
                            :placeholder="hasActiveMessage ? 'Wait for your ember to fade...' : 'Cast your message...'"
                            maxlength="70"
                            :disabled="hasActiveMessage"
                            autofocus
                            ref="inputRef"
                        >
                        <button class="send-btn" @click="sendMessage" :disabled="!inputText.trim() || hasActiveMessage">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `,
    setup(props, { emit }) {
        const messages = ref([]);
        const inputText = ref('');
        const myId = userId;
        const msgArea = ref(null);
        const inputRef = ref(null);
        const isFocused = ref(false);
        const isPrivate = computed(() => props.mode === 'private');
        const msgLimit = 12; // Standard cap for all rooms to ensure visibility
        let unsubscribe = null;
        let burnInterval = null;

        const hasActiveMessage = computed(() => messages.value.some(m => m.senderId === myId));

        const getCollectionRef = () => collection(db, 'messages');

        const scrollToBottom = () => {
            nextTick(() => {
                if (msgArea.value) msgArea.value.scrollTop = msgArea.value.scrollHeight;
            });
        };

        const checkAutoBurn = () => {
            const now = Date.now();
            const totalBurnTime = isPrivate.value ? 30000 : 60000;
            const yellowTime = isPrivate.value ? 12000 : 25000;
            const redTime = isPrivate.value ? 20000 : 40000;
            const criticalTime = isPrivate.value ? 27000 : 55000;

            messages.value.forEach(msg => {
                const created = msg.createdAt ? (msg.createdAt.toMillis ? msg.createdAt.toMillis() : now) : now;
                const age = now - created;

                if (age > criticalTime) msg.phase = 'critical';
                else if (age > redTime) msg.phase = 'red';
                else if (age > yellowTime) msg.phase = 'yellow';
                else msg.phase = 'normal';

                if (age > totalBurnTime) {
                    emit('burn');
                    deleteDoc(doc(getCollectionRef(), msg.id)).catch(err => console.error("Delete failed", err));
                }
            });
        };

        onMounted(() => {
            burnInterval = setInterval(checkAutoBurn, 1000);
            try {
                const targetRoom = props.roomCode || 'public';
                const colRef = getCollectionRef();
                // SECURITY: Use server-side filtering to only download messages for THIS room
                const q = query(
                    colRef,
                    where('roomId', '==', targetRoom),
                    orderBy('createdAt', 'asc')
                );

                unsubscribe = onSnapshot(q, (snapshot) => {
                    const newMsgs = [];
                    const senderMap = new Map();
                    let hasNew = false;

                    snapshot.forEach(doc => {
                        const data = doc.data();
                        newMsgs.push({ id: doc.id, ...data });
                        if (data.senderId && data.senderJoinedAt) senderMap.set(data.senderId, data.senderJoinedAt);
                    });

                    if (newMsgs.length > messages.value.length) hasNew = true;
                    messages.value = newMsgs;
                    emit('updateMessages', newMsgs);
                    emit('updateUsers', Array.from(senderMap.entries()).map(([id, joinedAt]) => ({ id, joinedAt })));
                    if (hasNew) scrollToBottom();
                    snapshot.docChanges().forEach((change) => { if (change.type === "removed") emit('burn'); });
                    if (newMsgs.length > msgLimit) deleteDoc(doc(getCollectionRef(), newMsgs[0].id));
                });
            } catch (err) { console.error("Error", err); }
        });

        const myGlyphIdx = computed(() => {
            const p = props.participants?.find(p => p.id === myId);
            return p ? p.glyphIdx : null;
        });

        const sendMessage = async () => {
            if (!inputText.value.trim() || hasActiveMessage.value) return;
            if (isPrivate.value) {
                const myMessages = messages.value.filter(m => m.senderId === myId).length;
                if (myMessages >= 2) {
                    alert("Your flame for this room is exhausted (2 messages max).");
                    inputText.value = '';
                    return;
                }
            }
            const text = inputText.value.trim();
            inputText.value = '';
            scrollToBottom();
            await addDoc(getCollectionRef(), {
                text, senderId: myId, senderJoinedAt: sessionJoinedAt,
                glyphIdx: myGlyphIdx.value,
                createdAt: serverTimestamp(), roomId: props.roomCode || 'public'
            });
        };


        const getUserGlyph = (msg) => {
            const glyphs = ['glyph-circle', 'glyph-square', 'glyph-triangle', 'glyph-x', 'glyph-plus', 'glyph-diamond', 'glyph-hex', 'glyph-pent', 'glyph-bolt', 'glyph-heart', 'glyph-star', 'glyph-moon', 'glyph-dot', 'glyph-bar', 'glyph-ring'];

            // 1. Use stored glyph index if message has one
            if (msg.glyphIdx !== undefined && msg.glyphIdx !== null) return glyphs[msg.glyphIdx];

            // 2. Fallback to current participant lookup
            const p = props.participants ? props.participants.find(p => p.id === msg.senderId) : null;
            if (p && p.glyphIdx !== undefined && p.glyphIdx < glyphs.length) return glyphs[p.glyphIdx];

            // 3. Last fallback: stable hash
            const id = msg.senderId;
            let hash = 0;
            for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
            const idx = Math.abs(hash) % glyphs.length;
            return glyphs[idx] + ' is-syncing';
        };

        return { messages, inputText, sendMessage, myId, msgArea, inputRef, isFocused, hasActiveMessage, getUserGlyph, myGlyphIdx };
    }
};

/* --- APP ROOT: Public --- */
const App = {
    components: { Atmosphere, Campfire, Chat, LoadingOverlay },
    template: `
        <div id="app-main" :class="{ 'immersive-mode': isImmersiveMode }">
            <Atmosphere />
            <Campfire 
                ref="campfireComponent"
                mode="public" 
                :userIds="activeUserIds"
                :participants="sessionParticipants"
                :activeMessages="isImmersiveMode ? sessionMessages : []"
                :seed="roomSeed"
                :isMuted="isMuted"
                :allow-rising="allowRising"
                @ready="handleReady"
                @audio-ready="handleAudioReady"
            />
            
            <button class="audio-toggle" :class="{ muted: isMuted }" @click="toggleMute">
                <svg v-if="!isMuted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2V15H6L11 19V5Z" />
                    <path d="M19.07 4.93C20.94 6.8 22 9.3 22 12C22 14.7 20.94 17.2 19.07 19.07" />
                    <path d="M15.54 8.46C16.48 9.4 17 10.65 17 12C17 13.35 16.48 14.6 15.54 15.54" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2V15H6L11 19V5Z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
            </button>
 
            <!-- Floating Exit Button for Immersive Mode -->
            <transition name="fade">
                <button v-if="isImmersiveMode" class="immersive-exit-btn" @click="toggleImmersiveMode" title="Exit Immersive Mode">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </transition>

            <transition name="monolith">
                <Chat 
                    v-if="!isLoading"
                    mode="public" 
                    :activeUserIds="activeUserIds"
                    :participants="sessionParticipants"
                    @back="goBack" 
                    @burn="handleBurn" 
                    @updateUsers="handleHistoryUpdate"
                    @updateMessages="msgs => sessionMessages = msgs"
                    @toggle-immersive="toggleImmersiveMode"
                />
            </transition>
            <transition name="fade">
                <LoadingOverlay v-if="isLoading" />
            </transition>
        </div>
    `,
    setup() {
        const campfireComponent = ref(null);
        const activeUserIds = ref([]);
        const roomSlots = ref([]);
        const roomSeed = ref(12345);
        const sessionMessages = ref([]);
        const isMuted = ref(localStorage.getItem('embers_muted') === 'true');
        const isLoading = ref(true);
        const audioSystem = ref(null);
        let presenceCleanup = null;

        const allowRising = ref(false);
        const isImmersiveMode = ref(false);

        const toggleMute = () => {
            isMuted.value = !isMuted.value;
            localStorage.setItem('embers_muted', isMuted.value);
            if (audioSystem.value) audioSystem.value.setMuted(isMuted.value);
        };

        const toggleImmersiveMode = () => {
            isImmersiveMode.value = !isImmersiveMode.value;
            // Trigger resize to recalculate Three.js camera aspect ratio
            // Multiple triggers to ensure it catches after CSS transition (0.8s)
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 100);
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 500);
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 1000);
        };

        const handleAudioReady = (system) => { audioSystem.value = system; };

        const isAssetsReady = ref(false);
        const isRegistrySynced = ref(false);

        const tryReveal = () => {
            if (isAssetsReady.value && isRegistrySynced.value && isLoading.value) {
                isLoading.value = false;

                // Clean sequential delay for monoliths
                // They rise AFTER the loading screen has faded out
                setTimeout(() => {
                    allowRising.value = true;
                }, 1200);

                const loader = document.getElementById('initial-loader');
                if (loader) {
                    loader.style.opacity = '0';
                    loader.style.pointerEvents = 'none';
                    setTimeout(() => loader.remove(), 1000);
                }
            }
        };

        const handleReady = () => {
            isAssetsReady.value = true;
            tryReveal();
        };

        const trackPresence = () => {
            const path = 'presence_public';
            const registryRef = doc(db, 'fire_registry/public');
            const presenceRef = doc(db, path, userId);

            setDoc(presenceRef, { userId, joinedAt: sessionJoinedAt, lastSeen: serverTimestamp() }, { merge: true });

            const syncSlots = async () => {
                try {
                    const presSnapshot = await getDocs(collection(db, path));
                    const now = Date.now();
                    const activeIds = presSnapshot.docs
                        .filter(d => (now - (d.data().lastSeen?.toMillis?.() || now) < 60000))
                        .map(d => d.id);

                    await runTransaction(db, async (transaction) => {
                        const regDoc = await transaction.get(registryRef);
                        const regData = regDoc.exists() ? regDoc.data() : {};
                        let slots = regData.slots || [];
                        let seed = regData.seed;

                        const othersActive = activeIds.filter(id => id !== userId);
                        const mySlotIdx = slots.findIndex(s => s && s.id === userId);

                        // Only reset seed/messages if NO ONE else is active AND we are joining fresh (not already in a slot)
                        if (!seed || (othersActive.length === 0 && mySlotIdx === -1)) {
                            seed = Math.floor(Math.random() * 1000000);
                            clearRoomMessages('public');
                        }

                        let cleanedSlots = slots.map(s => {
                            if (!s) return null;
                            if (s.id === userId || activeIds.includes(s.id)) {
                                // Transition fix: ensure every active slot has a joinedAt timestamp
                                if (!s.joinedAt) return { ...s, joinedAt: sessionJoinedAt };
                                return s;
                            }
                            return null;
                        });

                        if (mySlotIdx !== -1) {
                            transaction.set(registryRef, { slots: cleanedSlots, seed: seed || roomSeed.value }, { merge: true });
                            return;
                        }

                        // If NOT in slots, find a glyph from available ones
                        const takenGlyphs = cleanedSlots.filter(s => s).map(s => s.glyph);
                        const availableGlyphs = Array.from({ length: 15 }, (_, i) => i).filter(g => !takenGlyphs.includes(g));

                        if (availableGlyphs.length === 0) return; // Room truly full

                        const myGlyph = availableGlyphs[Math.floor(Math.random() * availableGlyphs.length)];
                        const emptyIndex = cleanedSlots.indexOf(null);

                        if (emptyIndex !== -1) cleanedSlots[emptyIndex] = { id: userId, glyph: myGlyph, joinedAt: sessionJoinedAt };
                        else cleanedSlots.push({ id: userId, glyph: myGlyph });

                        transaction.set(registryRef, { slots: cleanedSlots, seed }, { merge: true });
                    });
                } catch (e) { console.error("Registry sync failed", e); }
            };
            syncSlots();

            const unsubRegistry = onSnapshot(registryRef, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    const slots = data.slots || [];
                    roomSlots.value = slots;
                    if (data.seed) roomSeed.value = data.seed;

                    // Only mark as synced if our own ID is now in the registry (or it's full/error)
                    const hasMe = slots.some(s => s && s.id === userId);
                    if (hasMe || slots.filter(s => s).length >= 15) {
                        isRegistrySynced.value = true;
                        tryReveal();
                    }
                }
            });

            const heartbeat = setInterval(() => {
                updateDoc(presenceRef, { lastSeen: serverTimestamp() })
                    .catch(() => setDoc(presenceRef, { userId, joinedAt: sessionJoinedAt, lastSeen: serverTimestamp() }));
            }, 15000);

            const unsubPresence = onSnapshot(query(collection(db, path)), (snapshot) => {
                const now = Date.now();
                activeUserIds.value = snapshot.docs
                    .filter(d => now - (d.data().lastSeen?.toMillis?.() || now) < 45000)
                    .map(d => ({ id: d.data().userId, joinedAt: d.data().joinedAt || now }));
            });

            presenceCleanup = () => {
                clearInterval(heartbeat); unsubPresence(); unsubRegistry();
                deleteDoc(presenceRef).catch(() => { });
            };
            window.addEventListener('beforeunload', presenceCleanup);
        };

        onMounted(() => {
            // Remove static loader once Vue is mounted
            const loader = document.getElementById('initial-loader');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 1000);
            }

            document.body.classList.add('forest-bg');
            trackPresence();

            // Safety reveal if signals hang
            setTimeout(() => {
                if (isLoading.value) {
                    isAssetsReady.value = true;
                    isRegistrySynced.value = true;
                    tryReveal();
                }
            }, 12000);

            const unlock = () => {
                if (audioSystem.value) {
                    if (audioSystem.value.listener?.context.state === 'suspended') {
                        audioSystem.value.listener.context.resume();
                    }
                    if (typeof audioSystem.value.startAmbience === 'function') {
                        audioSystem.value.startAmbience();
                    }
                }
            };
            window.addEventListener('click', unlock, { once: true });
            window.addEventListener('touchstart', unlock, { once: true });
        });

        const sessionParticipants = computed(() => {
            const activeIds = activeUserIds.value.map(u => u.id);
            return roomSlots.value
                .filter(s => s && (s.id === userId || activeIds.includes(s.id)))
                .map(s => ({ id: s.id, glyphIdx: s.glyph, joinedAt: s.joinedAt }));
        });
        const clearRoomMessages = async (roomId) => {
            try {
                const q = query(collection(db, 'messages'), where('roomId', '==', roomId));
                const snapshot = await getDocs(q);
                const batch = snapshot.docs.map(d => deleteDoc(d.ref));
                await Promise.all(batch);
            } catch (e) { console.error("Message cleanup failed", e); }
        };

        const goBack = async () => {
            if (presenceCleanup) presenceCleanup();
            const registryRef = doc(db, 'fire_registry/public');
            try {
                await runTransaction(db, async (t) => {
                    const regDoc = await t.get(registryRef);
                    if (regDoc.exists()) {
                        let slots = regDoc.data().slots || [];
                        const myIdx = slots.findIndex(s => s && s.id === userId);
                        if (myIdx !== -1) {
                            slots[myIdx] = null;
                            const activeCount = slots.filter(s => s).length;
                            const nextSeed = (activeCount === 0) ? Math.floor(Math.random() * 1000000) : (regDoc.data().seed || seed);
                            t.update(registryRef, { slots, seed: nextSeed });
                            if (activeCount === 0) clearRoomMessages('public');
                        }
                    }
                });
            } catch (e) { }
            sessionStorage.removeItem('embers_user_id');
            sessionStorage.removeItem('embers_joined_at');
            window.location.href = 'index.html';
        };
        const handleBurn = () => { campfireComponent.value?.flare(); audioSystem.value?.playBurn(); };
        const handleHistoryUpdate = () => { };

        return { activeUserIds, campfireComponent, sessionParticipants, sessionMessages, roomSeed, isMuted, isLoading, allowRising, isImmersiveMode, toggleMute, toggleImmersiveMode, handleAudioReady, handleReady, goBack, handleBurn, handleHistoryUpdate };
    }
};

createApp(App).mount('#app');
