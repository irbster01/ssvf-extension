import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';
import { build } from 'esbuild';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'build-content-script',
      async closeBundle() {
        // Build content script with esbuild as IIFE
        await build({
          entryPoints: ['src/content/main.ts'],
          bundle: true,
          format: 'iife',
          outfile: 'dist/content/content.js',
          define: {
            '__API_URL__': JSON.stringify('https://ssvf-capture-api.azurewebsites.net/api/captures'),
          },
          minify: true,
        });
        console.log('✓ Content script built with esbuild');

        // Build background service worker with esbuild
        await build({
          entryPoints: ['src/background/serviceWorker.ts'],
          bundle: true,
          format: 'esm',
          outfile: 'dist/background/serviceWorker.js',
          minify: true,
        });
        console.log('✓ Background service worker built with esbuild');

        // Copy manifest
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
      },
      output: {
        entryFileNames: '[name]/[name].js',
        chunkFileNames: '[name]/[name].js',
        assetFileNames: '[name]/[name].[ext]',
      },
    },
  },
});
