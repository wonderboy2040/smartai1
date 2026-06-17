import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  esbuild: {
    ...(process.env.NODE_ENV === 'production' ? { drop: ['console', 'debugger'] } : {}),
    legalComments: 'none',
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    cssMinify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core — cached long-term
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          // Framer Motion / animations
          if (id.includes('node_modules/motion')) {
            return 'vendor-motion';
          }
          // Lucide icons
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          // Heavy utility modules — split for parallel loading
          if (id.includes('utils/telegram')) return 'utils-telegram';
          if (id.includes('utils/riskEngine') || id.includes('utils/screener') || id.includes('utils/dipEngine')) return 'utils-analysis';
          if (id.includes('utils/deepScanner') || id.includes('utils/wealthEngine')) return 'utils-scanner';
          if (id.includes('utils/tvWebsocket') || id.includes('utils/smartMoney')) return 'utils-market';
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
    include: ['react', 'react-dom', 'motion/react', 'lucide-react'],
  },
  server: {
    // Faster HMR in dev
    hmr: { overlay: true },
    warmup: {
      clientFiles: ['./src/App.tsx', './src/main.tsx'],
    },
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: true,
  },
});