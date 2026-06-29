import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
        host: '0.0.0.0',
        port: 3015,
        proxy: {
            '/api': {
                target: 'http://localhost:8483',
                changeOrigin: true,
                timeout: 300000,
                proxyTimeout: 300000,
            },
            '/static': { target: 'http://localhost:8483', changeOrigin: true },
        },
    },
});
