import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' lets the build work from any GitHub Pages path (user.github.io/PartsTracker/).
export default defineConfig({ base: './', plugins: [react()] })
