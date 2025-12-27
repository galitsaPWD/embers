import { ref, onMounted } from "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js";

export default {
    name: 'LandingBackground',
    template: `
        <div class="landing-bg">
            <div class="stars-container">
                <div v-for="star in stars" 
                     :key="star.id" 
                     class="star" 
                     :style="star.style">
                </div>
            </div>
            <div class="moon-container">
                <div class="moon"></div>
                <div class="moon-halo"></div>
            </div>
        </div>
    `,
    setup() {
        const stars = ref([]);

        onMounted(() => {
            const starCount = 150;
            const newStars = [];
            for (let i = 0; i < starCount; i++) {
                const size = Math.random() * 2 + 0.5;
                newStars.push({
                    id: i,
                    style: {
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                        width: `${size}px`,
                        height: `${size}px`,
                        opacity: Math.random() * 0.7 + 0.1,
                        '--duration': `${Math.random() * 3 + 2}s`,
                        '--delay': `${Math.random() * 5}s`
                    }
                });
            }
            stars.value = newStars;
        });

        return { stars };
    }
};
