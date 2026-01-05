import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("remark-cjk-friendly") ||
            id.includes("unified") ||
            id.includes("remark-") ||
            id.includes("micromark") ||
            id.includes("mdast") ||
            id.includes("hast")
          ) {
            return "markdown";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['0.0.0.0', 'disk-nan.exe.xyz'],
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
