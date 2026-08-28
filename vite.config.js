import { defineConfig } from 'vite';

// The studio is a plain Vite app: no framework, no plugins.
// Artworks are discovered at build/dev time by import.meta.glob in
// src/runtime/artwork-registry.js, so adding an artwork needs no config change.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    open: false
  },
  preview: {
    port: 4173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Artwork bundles can legitimately be large (three + shaders).
    chunkSizeWarningLimit: 1500
  }
});
