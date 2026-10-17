import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The windows' pages (React), served from app://cuttle/ by the main process.
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: '/',
  logLevel: 'warn',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome140',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        editor: fileURLToPath(new URL('./src/renderer/editor.html', import.meta.url)),
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
        picker: fileURLToPath(new URL('./src/renderer/picker.html', import.meta.url)),
        hud: fileURLToPath(new URL('./src/renderer/hud.html', import.meta.url)),
        countdown: fileURLToPath(new URL('./src/renderer/countdown.html', import.meta.url)),
      },
    },
  },
});
