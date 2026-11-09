import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// base './': BASE_PATH 가 무엇이든(루트 · /lang 등) 같은 빌드를 그대로 쓴다.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'NakamuraProject',
        short_name: 'Nakamura',
        description: '가나 · 한자 · 토익 매일 복습',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#faf9f6',
        theme_color: '#c2410c',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallbackDenylist: [/\/api\//] },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8081' } },
})
