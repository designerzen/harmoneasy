import { defineConfig } from 'vite'
import path from 'path'

/**
 * Vite config for Electron builds
 * Used by: npm run build:electron
 * 
 * This config handles native .node modules and sets up proper bundling
 * for Electron + Node.js runtime environment
 */

// Custom plugin to handle .node files - prevent bundling of native modules
const nodeAddonPlugin = {
  name: 'node-addon-loader',
  resolveId(id) {
    // Externalize any .node files completely
    if (id.endsWith('.node')) {
      return { id, external: true }
    }
    // Handle relative paths that reference .node files
    if (id.includes('.node')) {
      return { id, external: true }
    }
  },
  // Prevent vite from trying to analyze .node file imports
  load(id) {
    if (id.endsWith('.node')) {
      return null
    }
  }
}

export default defineConfig({
  base: './',
  server: {
    port: 5174 // Match the port Audiotool expects
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        'url',
        'path',
        /\.node$/,  // Externalize all .node files
        'fs',       // Node.js built-ins
        'module'    // Node.js module system
      ],
      output: {
        // Preserve external module references
        preserveModules: false,
        format: 'es'
      }
    },
    // Explicitly exclude node native modules from minification
    minify: 'esbuild'
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
  },
  plugins: [nodeAddonPlugin],
  ssr: {
    external: [/\.node$/, 'fs', 'path', 'module', 'url']
  }
})
