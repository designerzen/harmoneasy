import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/harmoneasy/' : '/',
  server: {
    port: 5174 // Match the port Audiotool expects
  },
  test: {
    globals: true,
    environment: 'node'
  }
})

