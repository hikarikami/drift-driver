import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const phasermsg = () => {
    return {
        name: 'phasermsg',
        buildStart() {
            process.stdout.write(`Building for production...\n`);
        },
        buildEnd() {
            const line = "---------------------------------------------------------";
            const msg = `❤️❤️❤️ Tell us about your game! - games@phaser.io ❤️❤️❤️`;
            process.stdout.write(`${line}\n${msg}\n${line}\n`);
            
            process.stdout.write(`✨ Done ✨\n`);
        }
    }
}

const pwaPlugin = VitePWA({
    registerType: 'autoUpdate',
    // Inline the SW registration so it works with base: './'
    injectRegister: 'inline',
    manifest: {
        name: "Ryan's Racer",
        short_name: "Racer",
        description: "Top-down arcade racing game",
        theme_color: "#1a1208",
        background_color: "#0f0f0f",
        display: "standalone",
        orientation: "landscape",
        start_url: ".",
        scope: ".",
        icons: [
            {
                src: "icon-512.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: "icon-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any maskable",
            },
        ],
    },
    workbox: {
        // Cache all game assets for offline play
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,ttf,mp3,wav,ogg,json}"],
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024,
        runtimeCaching: [
            {
                // Cache-first for all assets (fonts, images, audio)
                urlPattern: /\.(?:png|jpg|svg|ttf|woff2?|mp3|wav|ogg)$/,
                handler: "CacheFirst",
                options: {
                    cacheName: "game-assets",
                    expiration: {
                        maxEntries: 300,
                        maxAgeSeconds: 30 * 24 * 60 * 60,
                    },
                },
            },
        ],
    },
});

export default defineConfig({
    base: './',
    logLevel: 'warning',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2
            },
            mangle: true,
            format: {
                comments: false
            }
        }
    },
    server: {
        port: 8080
    },
    plugins: [
        phasermsg(),
        pwaPlugin,
    ]
});
