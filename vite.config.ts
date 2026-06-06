import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  esbuild: {
    ...(process.env.NODE_ENV === 'production' ? { drop: ['console'] } : {}),
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
          if (id.includes('crypto-js')) {
            return 'vendor-utils';
          }
          if (id.includes('node_modules/motion')) {
            return 'vendor-motion';
          }
          // Split heavy utils into separate chunks
          if (id.includes('utils/telegram')) return 'utils-telegram';
          if (id.includes('utils/riskEngine') || id.includes('utils/screener') || id.includes('utils/dipEngine')) return 'utils-analysis';
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