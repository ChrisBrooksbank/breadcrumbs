import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        tsconfigPaths(),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                cacheId: 'breadcrumbs-v3',
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            },
            manifest: {
                name: 'Breadcrumbs',
                short_name: 'Breadcrumbs',
                description:
                    'A map-free GPS breadcrumb PWA for recording walking routes and retracing your steps',
                theme_color: '#2563eb',
                background_color: '#f5f5f5',
                display: 'standalone',
                icons: [
                    {
                        src: '/icons/icon-192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: '/icons/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: '/icons/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
        }),
    ],
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
