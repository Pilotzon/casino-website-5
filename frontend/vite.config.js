import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend port the /api proxy points at. Override when 5000 is taken
// (e.g. macOS AirPlay Receiver): API_PORT=5001 npm run dev
const apiPort = process.env.API_PORT || 5000

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    // allow proxied/tunneled dev previews (e.g. sandbox preview hosts)
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  }
})