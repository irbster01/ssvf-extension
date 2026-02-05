import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        copyFileSync('manifest.json', 'dist/manifest.json');
        // Copy icons
        try {
          mkdirSync('dist/icons', { recursive: true });
          copyFileSync('icons/icon16.png', 'dist/icons/icon16.png');
          copyFileSync('icons/icon48.png', 'dist/icons/icon48.png');
          copyFileSync('icons/icon128.png', 'dist/icons/icon128.png');
        } catch (e) {
          console.warn('Warning: Could not copy icon files:', e);
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        content: resolve(__dirname, 'src/content/main.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'content' ? 'content/[name].js' : '[name]/[name].js';
        },
        chunkFileNames: '[name]/[name].js',
        assetFileNames: '[name]/[name].[ext]',
      },
    },
  },
});
