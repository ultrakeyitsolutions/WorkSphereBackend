import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 3000,
        strictPort: true,
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                secure: false,
            },
        },
        allowedHosts: true,
    },
    preview: {
        host: true,
        port: 4173,
        allowedHosts: true,
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
