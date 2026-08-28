import { defineConfig } from 'vite';
import capturePlugin from './vite-plugin-capture.js';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  plugins: [capturePlugin()],
});
