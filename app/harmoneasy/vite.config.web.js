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
      external: ['url', 'path', /\.node$/, 'netronome']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  },
  resolve: {
    conditions: ['browser', 'import'],
    alias: {
      'audiobus': path.resolve(__dirname, '../../packages/audiobus'),
      'audiotool': path.resolve(__dirname, '../../packages/audiotool'),
      'netronome': path.resolve(__dirname, '../../packages/netronome'),
      'opendaw': path.resolve(__dirname, '../../packages/openDAW'),
      'pink-trombone': path.resolve(__dirname, '../../packages/pink-trombone'),
      'midi-ble': path.resolve(__dirname, '../../packages/midi-ble'),
      'pitfalls': path.resolve(__dirname, '../../packages/pitfalls'),
      'flodjs': path.resolve(__dirname, '../../packages/flodjs')
    }
  }

})
