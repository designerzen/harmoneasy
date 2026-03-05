import { defineConfig } from 'vite'

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
      external: ['url', 'path', /\.node$/, 'netronome', 'audiobus', 'audiotool', 'flodjs', 'midi-ble', 'opendaw', 'pink-trombone', 'pitfalls']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  },
  resolve: {
    conditions: ['browser', 'import']
  }

})
