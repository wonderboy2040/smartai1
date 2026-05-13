import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  esbuild: {
    drop: ['console'],
    legalComments: 'none',
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('@google/generative-ai') || id.includes('@ai-sdk')) {
            return 'vendor-ml';
          }
          if (id.includes('framer-motion') || id.includes('motion')) {
            return 'vendor-motion';
          }
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('tailwindcss') || id.includes('clsx') || id.includes('tailwind-merge')) {
            return 'vendor-utils';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: true,
  },
});