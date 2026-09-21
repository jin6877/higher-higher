import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StatsPage } from './stats/StatsPage.tsx'
import { applyDocumentLang } from './i18n.ts'

// 문서 언어·제목·설명을 고른 언어로. index.html 에 박힌 값은 한국어이므로 영어일 때 덮어쓴다.
// (OG/트위터 태그는 크롤러가 JS 를 안 돌려서 여기선 못 바꾼다 — 서버에서 처리해야 한다.)
applyDocumentLang()

// 라우터를 들일 만큼 화면이 많지 않아 경로만 본다. 서버는 어떤 경로로 와도 index.html 을
// 돌려주므로(SPA 폴백) /stats 로 직접 들어와도 여기서 갈린다.
const isStats = window.location.pathname.replace(/\/+$/, "") === "/stats";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStats ? <StatsPage /> : <App />}
  </StrictMode>,
)
