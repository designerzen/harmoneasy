import { defineConfig } from 'vite'

const isElectron = process.env.VITE_ELECTRON === 'true'

export default defineConfig({
  base: isElectron ? './' : (process.env.NODE_ENV === 'production' ? '/harmoneasy/' : '/'),
  server: {
    port: 5174 // Match the port Audiotool expects
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['url', 'path']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  },
  resolve: {
    alias: {
      // Only alias these in specific contexts where they're not needed
      // Remove broad aliases to avoid breaking node_modules packages
    }
  }
})

