import { createApp, ref, onMounted, onUnmounted, computed, watch, nextTick } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import * as THREE from "https://unpkg.com/three@0.150.0/build/three.module.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, where, getDocs, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { Campfire } from './campfire.js?v=60';

console.log("Embers: Private Engine Booting...");

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

/* --- COMPONENT: Private Auth Modal --- */
const PrivateAuth = {
    template: `
        <div class="view-container auth-overlay">
            <div class="auth-modal redesign">
                <div class="auth-tabs">
                    <button class="tab-btn" :class="{ active: activeTab === 'join' }" @click="activeTab = 'join'">Join Room</button>
                    <button class="tab-btn" :class="{ active: activeTab === 'host' }" @click="activeTab = 'host'">Host Room</button>
                </div>

                <div class="auth-content-scroller">
                    <transition name="fade-slide" mode="out-in">
                        <!-- JOIN TAB -->
                        <div v-if="activeTab === 'join'" key="join" class="tab-pane">
                            <p class="pane-desc">Enter a 6-character room code to join an existing fire.</p>
                            <div class="auth-section">
                                <input v-model="joinCode" class="code-input primary-input" placeholder="ROOM CODE" maxlength="6" :disabled="isProcessing">
                                <input v-model="joinPass" type="password" class="code-input secondary-input" placeholder="Password (if any)" :disabled="isProcessing">
                                <button class="action-btn join-button" :disabled="joinCode.length < 6 || isProcessing" @click="joinRoom">
                                    {{ isProcessing ? 'Connecting...' : 'Enter the Fire' }}
                                </button>
                            </div>
                        </div>

                        <!-- HOST TAB -->
                        <div v-else key="host" class="tab-pane">
                            <p class="pane-desc">Create a new private sanctuary. Share the code with others.</p>
                            <div class="auth-section">
                                <input v-model="createPass" type="password" class="code-input primary-input" placeholder="Set Room Password (Optional)" :disabled="isProcessing">
                                <p class="input-hint">Leave blank for no password.</p>
                                <button class="action-btn host-button" @click="createRoom" :disabled="isProcessing">
                                    {{ isProcessing ? 'Igniting...' : 'Ignite New Room' }}
                                </button>
                            </div>
                        </div>
                    </transition>
                </div>

                <button class="text-btn cancel-btn" @click="$emit('cancel')" :disabled="isProcessing">Return to Landing</button>
                <transition name="fade">
                    <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>
                </transition>
            </div>
        </div>
    `,
    setup(props, { emit }) {
        const activeTab = ref('join'); // 'join' or 'host'
        const joinCode = ref('');
        const joinPass = ref('');
        const createPass = ref('');
        const isProcessing = ref(false);
        const errorMsg = ref('');

        const createRoom = async () => {
            isProcessing.value = true;
            errorMsg.value = '';
            try {
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                let code = '';
                for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

                await setDoc(doc(db, 'privateRooms', code), {
                    createdAt: serverTimestamp(),
                    activeUsersCount: 0,
                    password: createPass.value.trim() || null
                });
                emit('confirm', code);
            } catch (e) { errorMsg.value = "Failed to create room."; }
            finally { isProcessing.value = false; }
        };

        const joinRoom = async () => {
            const code = joinCode.value.toUpperCase();
            isProcessing.value = true;
            errorMsg.value = '';
            try {
                const roomSnap = await getDoc(doc(db, 'privateRooms', code));
                if (!roomSnap.exists()) { errorMsg.value = "Room not found."; return; }

                const roomData = roomSnap.data();
                if (roomData.password && roomData.password !== joinPass.value.trim()) {
                    errorMsg.value = "Incorrect password.";
                    return;
                }

                const presSnapshot = await getDocs(collection(db, `presence_${code}`));
                const now = Date.now();
                const activeCount = presSnapshot.docs.filter(d => (now - (d.data().lastSeen?.toMillis?.() || now) < 60000)).length;
                if (activeCount >= 5) { errorMsg.value = "Room is full."; return; }
                emit('confirm', code);
            } catch (e) {
                console.error(e);
                errorMsg.value = "Error joining room.";
            }
            finally { isProcessing.value = false; }
        };

        return { activeTab, joinCode, joinPass, createPass, isProcessing, errorMsg, createRoom, joinRoom };
    }
};

/* --- COMPONENT: Chat Interface --- */
const Chat = {
    props: ['mode', 'roomCode', 'activeUserIds', 'participants'],
    template: `
        <div class="view-container chat-layout is-private">
            <transition name="monolith" appear>
                <div class="glass-panel">
                    <div class="chat-header">
                        <button class="icon-btn back-btn" @click="$emit('back')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                            <span>Back</span>
                        </button>
                        <div class="room-info">
                            <span class="mode-label">Private Room</span>
                            <span class="room-code">{{ roomCode }}</span>
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
                        <div class="input-capsule" :class="{ 'focused': isFocused, 'disabled': reachesMessageLimit }">
                            <input 
                                v-model="inputText" 
                                @keyup.enter="sendMessage" 
                                @focus="isFocused = true"
                                @blur="isFocused = false"
                                :placeholder="reachesMessageLimit ? 'Limit reached. Wait for embers to fade...' : 'Cast your message...'"
                                maxlength="60"
                                :disabled="reachesMessageLimit"
                                autofocus
                                ref="inputRef"
                            >
                            <button class="send-btn" @click="sendMessage" :disabled="!inputText.trim() || reachesMessageLimit">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </transition>
        </div>
    `,
    setup(props, { emit }) {
        const messages = ref([]);
        const inputText = ref('');
        const myId = userId;
        const msgArea = ref(null);
        const inputRef = ref(null);
        const isFocused = ref(false);
        let unsubscribe = null;
        let burnInterval = null;
        const isTyping = ref(false);
        let typingTimeout = null;

        const reachesMessageLimit = computed(() => {
            const myCount = messages.value.filter(m => m.senderId === myId).length;
            return myCount >= 2;
        });
        const getCollectionRef = () => collection(db, 'messages');

        const scrollToBottom = () => {
            nextTick(() => { if (msgArea.value) msgArea.value.scrollTop = msgArea.value.scrollHeight; });
        };

        const checkAutoBurn = () => {
            const now = Date.now();
            const totalBurnTime = 30000;
            const yellowTime = 12000;
            const redTime = 20000;
            const criticalTime = 27000;

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
                // SECURITY: Server-side filtering ensures you only get messages for YOUR room
                const q = query(
                    getCollectionRef(),
                    where('roomId', '==', props.roomCode),
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
                    emit('updateUsers', Array.from(senderMap.entries()).map(([id, joinedAt]) => ({ id, joinedAt })));
                    if (hasNew) scrollToBottom();
                    snapshot.docChanges().forEach((change) => { if (change.type === "removed") emit('burn'); });
                    if (newMsgs.length > 25) deleteDoc(doc(getCollectionRef(), newMsgs[0].id));
                });
            } catch (err) { console.error("Error", err); }
        });

        watch(messages, (newVal) => {
            emit('updateMessages', newVal);
        }, { deep: true });

        const myGlyphIdx = computed(() => {
            const p = props.participants?.find(p => p.id === myId);
            return p ? p.glyphIdx : null;
        });

        const sendMessage = async () => {
            if (!inputText.value.trim() || reachesMessageLimit.value) return;

            const text = inputText.value.trim();
            await addDoc(getCollectionRef(), {
                text, senderId: myId, senderJoinedAt: sessionJoinedAt,
                glyphIdx: myGlyphIdx.value,
                createdAt: serverTimestamp(), roomId: props.roomCode
            });
        };

        // --- Typing Detection ---
        watch(inputText, (newVal) => {
            if (newVal.trim().length > 0) {
                if (!isTyping.value) {
                    isTyping.value = true;
                    updatePresence(true);
                }
                if (typingTimeout) clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    isTyping.value = false;
                    updatePresence(false);
                }, 3000);
            } else {
                if (isTyping.value) {
                    isTyping.value = false;
                    updatePresence(false);
                }
            }
        });

        const updatePresence = (typing) => {
            if (!props.roomCode) return;
            const presenceRef = doc(db, 'presence_' + props.roomCode, myId);
            updateDoc(presenceRef, { isTyping: typing, lastSeen: serverTimestamp() }).catch(() => { });
        };

        const getUserGlyph = (msg) => {
            const glyphs = ['glyph-circle', 'glyph-square', 'glyph-triangle', 'glyph-x', 'glyph-plus', 'glyph-diamond', 'glyph-hex', 'glyph-pent', 'glyph-bolt', 'glyph-heart', 'glyph-star', 'glyph-moon', 'glyph-dot', 'glyph-bar', 'glyph-ring'];
            if (msg.glyphIdx !== undefined && msg.glyphIdx !== null) return glyphs[msg.glyphIdx];
            const p = props.participants ? props.participants.find(p => p.id === msg.senderId) : null;
            if (p && p.glyphIdx !== undefined) return glyphs[p.glyphIdx];
            const id = msg.senderId;
            let hash = 0;
            for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
            const idx = Math.abs(hash) % glyphs.length;
            return glyphs[idx] + ' is-syncing';
        };

        return {
            messages, inputText, sendMessage, myId, msgArea, inputRef, isFocused,
            reachesMessageLimit, getUserGlyph, myGlyphIdx, isTyping
        };
    }
};

/* --- APP ROOT: Private --- */
const App = {
    components: { Atmosphere, Campfire, Chat, LoadingOverlay, PrivateAuth },
    template: `
        <div id="app-main" :class="{ 'immersive-mode': isImmersiveMode }">
            <Atmosphere />
            <Campfire 
                v-if="viewState === 'chat'"
                ref="campfireComponent"
                mode="private" 
                :userIds="activeUserIds"
                :participants="sessionParticipants"
                :seed="roomSeed"
                :isMuted="isMuted"
                :allow-rising="allowRising"
                :activeMessages="isImmersiveMode ? sessionMessages : []"
                @ready="handleReady"
                @audio-ready="handleAudioReady"
            />
            
            <button v-if="viewState !== 'auth'" class="audio-toggle" :class="{ muted: isMuted }" @click="toggleMute">
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
 
            <transition name="fade" mode="out-in">
                <PrivateAuth v-if="viewState === 'auth'" @cancel="goHome" @confirm="startPrivateChat" />
                <Chat 
                    v-else-if="!isLoading"
                    mode="private" 
                    :roomCode="activeRoomCode"
                    :activeUserIds="activeUserIds"
                    :participants="sessionParticipants"
                    @back="goBack" 
                    @burn="handleBurn" 
                    @updateUsers="handleHistoryUpdate" 
                    @updateMessages="msgs => sessionMessages = msgs"
                    @toggle-immersive="toggleImmersiveMode"
                />
            </transition>


            <!-- Floating Exit Button for Immersive Mode -->
            <transition name="fade">
                <button v-if="isImmersiveMode && viewState === 'chat'" class="immersive-exit-btn" @click="toggleImmersiveMode" title="Exit Immersive Mode">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </transition>

            <LoadingOverlay v-if="isLoading && viewState === 'chat'" />
        </div>
    `,
    setup() {
        const viewState = ref('auth');
        const activeRoomCode = ref(null);
        const campfireComponent = ref(null);
        const activeUserIds = ref([]);
        const roomSlots = ref([]);
        const roomSeed = ref(12345);
        const isMuted = ref(localStorage.getItem('embers_muted') === 'true');
        const isLoading = ref(false);
        const isImmersiveMode = ref(false);
        const isTransitioning = ref(false);
        const sessionMessages = ref([]);
        const audioSystem = ref(null);
        let presenceCleanup = null;

        const toggleMute = () => {
            isMuted.value = !isMuted.value;
            localStorage.setItem('embers_muted', isMuted.value);
            if (audioSystem.value) audioSystem.value.setMuted(isMuted.value);
        };

        const toggleImmersiveMode = () => {
            isImmersiveMode.value = !isImmersiveMode.value;
            // Multiple triggers to ensure it catches after CSS transitions
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 500);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 1000);
        };

        const handleAudioReady = (system) => { audioSystem.value = system; };

        let landingAudio = null;
        let landingStarted = false;

        const startLandingMusic = () => {
            if (landingStarted) return;
            landingAudio = new Audio('assets/landing_page_bg.mp3');
            landingAudio.loop = true;
            landingAudio.volume = 0;
            landingAudio.play().then(() => {
                landingStarted = true;
                let vol = 0;
                const fade = setInterval(() => {
                    if (!landingAudio) { clearInterval(fade); return; }
                    if (vol < 0.4) {
                        vol += 0.02;
                        landingAudio.volume = vol;
                    } else { clearInterval(fade); }
                }, 100);
            }).catch(() => { });
        };

        const stopLandingMusic = () => {
            if (!landingAudio) return;
            let vol = landingAudio.volume;
            const fade = setInterval(() => {
                if (!landingAudio) { clearInterval(fade); return; }
                if (vol > 0.02) {
                    vol -= 0.02;
                    landingAudio.volume = vol;
                } else {
                    landingAudio.pause();
                    landingAudio = null;
                    clearInterval(fade);
                }
            }, 50);
        };

        const isAssetsReady = ref(false);
        const isRegistrySynced = ref(false);

        const tryReveal = () => {
            if (isAssetsReady.value && isRegistrySynced.value && isLoading.value) {
                isLoading.value = false;
                // Clean sequential delay for monoliths
                setTimeout(() => {
                    allowRising.value = true;
                }, 1200);
            }
        };

        const trackPresence = (roomCode) => {
            const path = `presence_${roomCode}`;
            const registryPath = `fire_registry/${roomCode}`;
            const presenceRef = doc(db, path, userId);
            const registryRef = doc(db, registryPath);

            setDoc(presenceRef, { userId, joinedAt: sessionJoinedAt, lastSeen: serverTimestamp() }, { merge: true });

            const syncSlots = async (retryCount = 0) => {
                console.log(`Embers: Slot sync attempt ${retryCount + 1}...`);
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

                        console.log("Registry Status:", { room: roomCode, activeCount: activeIds.length, seedReady: !!seed });

                        if (!seed || (othersActive.length === 0 && mySlotIdx === -1)) {
                            seed = Math.floor(Math.random() * 1000000);
                            clearRoomMessages(roomCode);
                        }

                        let cleanedSlots = slots.map(s => {
                            if (!s) return null;
                            if (s.id === userId || activeIds.includes(s.id)) {
                                if (!s.joinedAt) return { ...s, joinedAt: sessionJoinedAt };
                                return s;
                            }
                            return null;
                        });

                        if (mySlotIdx === -1) {
                            const takenGlyphs = cleanedSlots.filter(s => s).map(s => s.glyph);
                            const availableGlyphs = Array.from({ length: 15 }, (_, i) => i).filter(g => !takenGlyphs.includes(g));
                            if (availableGlyphs.length > 0 && cleanedSlots.filter(s => s).length < 5) {
                                const myGlyph = availableGlyphs[Math.floor(Math.random() * availableGlyphs.length)];
                                const emptyIndex = cleanedSlots.indexOf(null);
                                if (emptyIndex !== -1) cleanedSlots[emptyIndex] = { id: userId, glyph: myGlyph, joinedAt: sessionJoinedAt };
                                else cleanedSlots.push({ id: userId, glyph: myGlyph, joinedAt: sessionJoinedAt });
                            }
                        }

                        transaction.set(registryRef, { slots: cleanedSlots, seed }, { merge: true });
                    });
                } catch (e) {
                    console.error("Registry sync failed", e);
                    if (retryCount < 3) setTimeout(() => syncSlots(retryCount + 1), 1000);
                }
            };
            syncSlots();

            const unsubRegistry = onSnapshot(registryRef, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    const slots = data.slots || [];
                    roomSlots.value = slots;
                    if (data.seed) roomSeed.value = data.seed;

                    const hasMe = slots.some(s => s && s.id === userId);
                    console.log("Registry snapshot updated. Has me:", hasMe, "Slots count:", slots.filter(s => s).length);

                    if (hasMe || slots.filter(s => s).length >= 5) {
                        isRegistrySynced.value = true;
                        tryReveal();
                    }
                } else {
                    console.log("Fire registry is being prepared...");
                }
            }, (error) => {
                console.error("Registry snapshot error:", error);
            });

            const heartbeat = setInterval(() => {
                updateDoc(presenceRef, { lastSeen: serverTimestamp() })
                    .catch(() => setDoc(presenceRef, { userId, joinedAt: sessionJoinedAt, lastSeen: serverTimestamp() }));
            }, 15000);

            const unsubPresence = onSnapshot(query(collection(db, path)), (snapshot) => {
                const now = Date.now();
                activeUserIds.value = snapshot.docs
                    .filter(d => now - (d.data().lastSeen?.toMillis?.() || now) < 60000)
                    .map(d => ({ id: d.data().userId, joinedAt: d.data().joinedAt || now }));
            });

            presenceCleanup = () => {
                clearInterval(heartbeat); unsubPresence(); unsubRegistry();
                deleteDoc(presenceRef).catch(() => { });
                presenceCleanup = null;
            };
            window.addEventListener('beforeunload', presenceCleanup);
        };

        const allowRising = ref(false);

        const handleReady = () => {
            isAssetsReady.value = true;
            tryReveal();
        };

        const startPrivateChat = (code) => {
            isLoading.value = true;
            nextTick(() => {
                activeRoomCode.value = code;
                viewState.value = 'chat';
                trackPresence(code);
                document.body.classList.add('forest-bg');
                stopLandingMusic();
            });

            // Safety reveal if sync or assets hang
            setTimeout(() => {
                if (isLoading.value) {
                    console.warn("Safety reveal triggered - sync or asset load may be slow.");
                    isAssetsReady.value = true;
                    isRegistrySynced.value = true;
                    tryReveal();
                }
            }, 8000);
        };

        onMounted(() => {
            isMuted.value = !localStorage.getItem('embers_audio_enabled');
            const unlock = () => {
                if (audioSystem.value?.listener?.context.state === 'suspended') audioSystem.value.listener.context.resume();
                startLandingMusic();
            };
            window.addEventListener('click', unlock, { once: true });
            window.addEventListener('touchstart', unlock, { once: true });
            window.addEventListener('keydown', unlock, { once: true });

            // Remove initial-loader immediately on mount for auth view
            const loader = document.getElementById('initial-loader');
            if (loader) {
                loader.style.opacity = '0';
                loader.style.pointerEvents = 'none';
                setTimeout(() => loader.remove(), 1000);
            }
        });

        const sessionParticipants = computed(() => {
            const activeIds = activeUserIds.value.map(u => u.id);
            return roomSlots.value
                .filter(s => s && (s.id === userId || activeIds.includes(s.id)))
                .map(s => ({ id: s.id, glyphIdx: s.glyph, joinedAt: s.joinedAt }));
        });
        const goHome = () => { window.location.href = 'index.html'; };
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
            const roomId = activeRoomCode.value;
            const registryRef = doc(db, `fire_registry/${roomId}`);
            try {
                await runTransaction(db, async (t) => {
                    const regDoc = await t.get(registryRef);
                    if (regDoc.exists()) {
                        let slots = regDoc.data().slots || [];
                        const myIdx = slots.findIndex(s => s && s.id === userId);
                        if (myIdx !== -1) {
                            slots[myIdx] = null;
                            const activeCount = slots.filter(s => s).length;

                            if (activeCount === 0) {
                                // Last one out - kill the room to save storage
                                t.delete(registryRef);
                                t.delete(doc(db, 'privateRooms', roomId));
                                clearRoomMessages(roomId);
                            } else {
                                // Others still here - just update the slots
                                const nextSeed = regDoc.data().seed || seed;
                                t.update(registryRef, { slots, seed: nextSeed });
                            }
                        }
                    }
                });
            } catch (e) { }
            sessionStorage.removeItem('embers_joined_at');
            window.location.href = 'index.html';
        };
        const handleBurn = () => { campfireComponent.value?.flare(); audioSystem.value?.playBurn(); };
        const handleHistoryUpdate = () => { };


        return { viewState, activeRoomCode, activeUserIds, campfireComponent, sessionParticipants, sessionMessages, roomSeed, isMuted, isLoading, allowRising, isImmersiveMode, isTransitioning, toggleMute, toggleImmersiveMode, handleAudioReady, handleReady, startPrivateChat, goBack, handleBurn, handleHistoryUpdate, goHome };
    }
};

createApp(App).mount('#app');
