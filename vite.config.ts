import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    // Optimizations for smaller bundle
    target: 'es2015',
    minify: 'esbuild',
    // esbuild options
    esbuild: {
      drop: console, // Remove console statements
      legalComments: 'none',
    },
    // Code splitting not possible with singlefile plugin
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  // Disable source maps for production to reduce size
  preview: {
    enabled: true,
  },
});
