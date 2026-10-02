import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // MapLibre is ~800 kB on its own; keep it in a separate, long-cached chunk.
    chunkSizeWarningLimit: 1100,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
  },
});
