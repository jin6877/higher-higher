import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 로컬 개발: 게임(vite dev)에서 /api·/healthz 를 로컬 랭킹 서버(server/, :8080)로 프록시.
  // 운영에선 게임 정적파일과 API 를 같은 컨테이너가 서빙하므로 프록시가 필요 없다.
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
})
