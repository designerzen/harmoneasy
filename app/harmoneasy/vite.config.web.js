import { defineConfig } from 'vite'

const unavailableNativeAddon = '\0web-native-addon-unavailable'

// Native adapters are optional and already catch failed addon imports. Resolve
// them to a rejecting JS module in the browser, including during dev analysis.
const webNativeAddonPlugin = {
  name: 'web-native-addon',
  enforce: 'pre',
  resolveId(id) {
    if (/\.node(?:\?|$)/.test(id)) return unavailableNativeAddon
  },
  load(id) {
    if (id === unavailableNativeAddon) {
      return 'throw new Error("Native Node.js addons are unavailable in the web app"); export default null;'
    }
  }
}

/**
 * Vite config for web-only builds
 * Used by: npm run build (GitHub Actions)
 */

export default defineConfig({
  plugins: [webNativeAddonPlugin],
  // Resolve through the workspace package and bundle Nexus's CommonJS dependencies
  // (including toposort); serving the SDK unbundled breaks browser imports.
  optimizeDeps: { include: ['audiotool > @audiotool/nexus', 'audiotool > @audiotool/nexus/utils'] },
  base: process.env.NODE_ENV === 'production' ? '/harmoneasy/' : '/',
  server: {
    port: 5174
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      external: ['url', 'path']
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
