import { createApp, ref, onMounted, onUnmounted, computed, watch, nextTick } from "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js";
import { Campfire } from './campfire.js?v=60';

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

/* --- COMPONENT: Landing Page --- */
const Landing = {
    setup() {
        const titleRef = ref(null);
        const sloganRef = ref(null);
        const navGroup = ref(null);
        let audio = null;
        let hasInteracted = false;

        onMounted(() => {
            sessionStorage.removeItem('embers_user_id');
            sessionStorage.removeItem('embers_joined_at');

            audio = new Audio('assets/landing_page_bg.mp3');
            audio.loop = true;
            audio.volume = 0;

            // Global listeners to unlock audio
            window.addEventListener('click', handleMouseMove, { once: false });
            window.addEventListener('keydown', handleMouseMove, { once: false });
            window.addEventListener('touchstart', handleMouseMove, { once: false });
            window.addEventListener('mousedown', handleMouseMove, { once: false });
        });

        onUnmounted(() => {
            window.removeEventListener('click', handleMouseMove);
            window.removeEventListener('keydown', handleMouseMove);
            window.removeEventListener('touchstart', handleMouseMove);
            window.removeEventListener('mousedown', handleMouseMove);
            if (audio) {
                audio.pause();
                audio = null;
            }
        });

        const handleMouseMove = (e) => {
            // Support Touch Coordinates
            let clientX = e.clientX;
            let clientY = e.clientY;

            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            }

            // Audio initialization try
            if (!hasInteracted && audio) {
                audio.play()
                    .then(() => {
                        hasInteracted = true;
                        // Smooth fade to 50% volume
                        let vol = 0;
                        const fade = setInterval(() => {
                            if (!audio) { clearInterval(fade); return; }
                            if (vol < 0.5) {
                                vol += 0.02;
                                audio.volume = Math.min(vol, 0.5);
                            } else {
                                clearInterval(fade);
                            }
                        }, 100);
                    })
                    .catch(err => { });
            }

            const updateGradient = (element) => {
                if (!element) return;
                const rect = element.getBoundingClientRect();
                const x = clientX - rect.left;
                const y = clientY - rect.top;
                element.style.setProperty('--cursor-x', `${x}px`);
                element.style.setProperty('--cursor-y', `${y}px`);
            };

            updateGradient(titleRef.value);
            updateGradient(sloganRef.value);

            if (navGroup.value) {
                const btns = navGroup.value.querySelectorAll('.minimal-btn');
                btns.forEach(updateGradient);
            }
        };

        return { titleRef, sloganRef, navGroup, handleMouseMove };
    },
    template: `
        <div class="view-container minimal-landing" 
             @mousemove="handleMouseMove" 
             @touchstart="handleMouseMove" 
             @touchmove="handleMouseMove">
            <div class="noise-overlay"></div>
            <h1 class="landing-title" ref="titleRef">EMBERS</h1>
            <div class="landing-slogan" ref="sloganRef">choose your flame</div>
            
            <div class="landing-nav" ref="navGroup">
                <a href="public.html" class="minimal-btn">
                    <span class="btn-main">Public Fire</span>
                    <span class="btn-sub">shared &middot; max 15</span>
                </a>
                <a href="private.html" class="minimal-btn">
                    <span class="btn-main">Private Fire</span>
                    <span class="btn-sub">exclusive &middot; max 5</span>
                </a>
            </div>
        </div>
    `
};

/* --- APP ROOT --- */
const App = {
    components: { Atmosphere, Campfire, Landing },
    setup() {
        onMounted(() => {
            // Remove static loader once Vue is mounted
            const loader = document.getElementById('initial-loader');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 1000);
            }
        });
    },
    template: `
        <div id="app-main">
            <Atmosphere />
            <Campfire 
                mode="landing" 
                :userCount="0" 
                :userIds="[]" 
                :participants="[]"
                :activeMessages="[]"
                :isMuted="true"
                :seed="12345"
            />
            <Landing />
        </div>
    `
};

createApp(App).mount('#app');
