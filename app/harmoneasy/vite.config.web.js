import { defineConfig } from 'vite'
import { opendawFilesPlugin } from 'audiobus/instruments/openDAW/opendaw-files.js'
import { createReadStream } from 'node:fs'
import { resolve, sep } from 'node:path'
import { midiDeviceFilesPlugin } from 'audiobus/midi/hardware/device-files.js'
import { supersonicFilesPlugin } from 'audiobus/io/outputs/supersonic-files.js'
import { roomPagesPlugin } from './scripts/room-pages.js'

// Vite's static middleware emits an empty MIME type for .tar.gz bundles.
// Serve WCLAP archives explicitly so browser fetch does not treat them as downloads.
const webclapBundlesPlugin = {
  name: 'webclap-bundles',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (!pathname.startsWith('/webclap/plugins/') || !pathname.endsWith('.tar.gz')) return next()
      const root = resolve(server.config.publicDir)
      const path = resolve(root, '.' + decodeURIComponent(pathname))
      if (!path.startsWith(root + sep)) return next()
      response.setHeader('Content-Type', 'application/gzip')
      const stream = createReadStream(path)
      stream.on('error', () => { response.statusCode = 404; response.end('WebCLAP bundle not found') })
      stream.pipe(response)
    })
  },
}

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
  plugins: [webNativeAddonPlugin, webclapBundlesPlugin, midiDeviceFilesPlugin(), supersonicFilesPlugin(), opendawFilesPlugin(), roomPagesPlugin()],
  worker: { format: 'es' },
  // Resolve through the workspace package and bundle Nexus's CommonJS dependencies
  // (including toposort); serving the SDK unbundled breaks browser imports.
  optimizeDeps: { include: ['audiotool > @audiotool/nexus', 'audiotool > @audiotool/nexus/utils'] },
  base: process.env.NODE_ENV === 'production' ? '/harmoneasy/' : '/',
  server: {
    port: 1999
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      external: ['url', 'path']
    }
  },
  test: {
    setupFiles: ['./tests/midi-profile-runtime-setup.ts'],
    globals: true,
    environment: 'node'
  },
  resolve: {
    conditions: ['browser', 'import']
  }

})
