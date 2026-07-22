import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: client on :3000, API/websockets proxied to the server on :3001.
// `host: true` exposes the dev server on the LAN so invite links like
// http://192.168.x.x:3000/join/ABC123 work out of the box.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' }
    }
  },
  build: { outDir: 'dist' }
});
