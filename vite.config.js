import { defineConfig } from 'vite';
import capturePlugin from './vite-plugin-capture.js';

export default defineConfig({
  base: '/Valleyball-Versus/',
  server: { port: 5173, strictPort: true },
  plugins: [capturePlugin()],
});
