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
      external: ['url', 'path', /\.node$/]
    }
  },
  test: {
    globals: true,
    environment: 'node'
  },
  resolve: {
    alias: {
      'audiobus': new URL('../../../packages/audiobus', import.meta.url).pathname,
      'audiotool': new URL('../../../packages/audiotool', import.meta.url).pathname,
      'opendaw': new URL('../../../packages/openDAW', import.meta.url).pathname,
      'pink-trombone': new URL('../../../packages/pink-trombone', import.meta.url).pathname,
      'midi-ble': new URL('../../../packages/midi-ble', import.meta.url).pathname,
      'pitfalls': new URL('../../../packages/pitfalls', import.meta.url).pathname,
      'flodjs': new URL('../../../packages/flodjs', import.meta.url).pathname
    }
  }
})
