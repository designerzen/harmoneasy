import { defineConfig } from 'vite'
import path from 'path'

/**
 * Vite config for web-only builds
 * Used by: npm run build (GitHub Actions)
 */

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/harmoneasy/' : '/',
  server: {
    port: 5174
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['url', 'path', /\.node$/]
    }
  },
  test: {
    globals: true,
    environment: 'node'
  },

})
