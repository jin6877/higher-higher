import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StatsPage } from './stats/StatsPage.tsx'

// 라우터를 들일 만큼 화면이 많지 않아 경로만 본다. 서버는 어떤 경로로 와도 index.html 을
// 돌려주므로(SPA 폴백) /stats 로 직접 들어와도 여기서 갈린다.
const isStats = window.location.pathname.replace(/\/+$/, "") === "/stats";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStats ? <StatsPage /> : <App />}
  </StrictMode>,
)
