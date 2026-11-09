import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The app lives in app/ so the dev server can't serve files from the repo root
// (secrets.json sits there).
export default defineConfig({
  root: 'app',
  base: './',
  plugins: [vue()],
  server: {
    // A fixed port keeps one origin, so sign-in redirects always
    // come back to the same place.
    port: 5173,
    strictPort: true,
    // Serve only the app and its packages; never the keys.
    fs: {
      allow: [here('./app'), here('./node_modules')],
      deny: ['secrets.json', '.env', '.env.*'],
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['app/src/**/*.test.js'],
    // The first test after a cold transform can pass 5s, mostly when `npm run dev` runs alongside.
    testTimeout: 15000,
  },
});
