import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// GitHub Pages project page: https://mysimyg.github.io/wattnap/
export default defineConfig({
  base: process.env.VITE_BASE || '/wattnap/',
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: true },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
})
