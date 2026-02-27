import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pwaPlugin = VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'inline',
    // Enable in dev so the manifest and SW are available for local testing.
    // Set to false if the SW cache causes stale-asset issues during development.
    devOptions: {
        enabled: true,
    },
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
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,ttf,mp3,wav,ogg,json}"],
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024,
    },
});

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
    },
    server: {
        port: 8080
    },
    plugins: [
        pwaPlugin,
    ]
});
