import { defineConfig } from 'vite'

const isElectron = process.env.VITE_ELECTRON === 'true'

export default defineConfig({
  base: isElectron ? './' : (process.env.NODE_ENV === 'production' ? '/harmoneasy/' : '/'),
  server: {
    port: 5174 // Match the port Audiotool expects
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  test: {
    globals: true,
    environment: 'node'
  }
})

