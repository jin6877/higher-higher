/**
 * 한국어 / 영어 두 벌.
 *
 * 고르는 순서 — 앞에서 정해지면 뒤는 보지 않는다:
 *   1. ?lang=ko|en   — 링크로 특정 언어를 강제할 때(테스트·공유용)
 *   2. localStorage  — 사용자가 직접 바꾼 적이 있으면 그 선택을 계속 따른다
 *   3. navigator.languages — 브라우저 언어 목록에 한국어가 있으면 한국어, 아니면 영어
 *
 * "나라" 가 아니라 "언어" 로 고른다. 클라이언트만으로 접속 국가를 알 방법이 없기도 하고,
 * 해외에 있는 한국어 사용자에게 영어를 보여주는 게 더 나쁜 결과라서다. 한국어를 읽는
 * 사람은 어디서 접속하든 한국어를 본다.
 *
 * 언어는 런타임에 바뀌지 않는다(바꾸면 setLang 이 새로고침한다). 그래서 t 를 모듈 상수로
 * 둘 수 있고, 캔버스를 그리는 엔진처럼 React 바깥에 있는 코드도 그냥 import 해서 쓴다.
 */
export type Lang = "ko" | "en";

const STORAGE_KEY = "hh.lang";

function isLang(v: unknown): v is Lang {
  return v === "ko" || v === "en";
}

function detect(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (isLang(q)) return q;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* 사생활 보호 모드 등에서 localStorage 접근이 막히면 브라우저 언어로 넘어간다 */
  }
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return list.some((l) => l?.toLowerCase().startsWith("ko")) ? "ko" : "en";
}

export const lang: Lang = detect();

/** 언어를 바꾸고 새로고침. 캔버스에 그려 둔 글자까지 확실히 새로 그리려면 이 방법이 가장 싸다. */
export function setLang(next: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 저장 못 해도 이번 방문에는 적용된다 */
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("lang"); // 저장된 선택이 쿼리에 가려지지 않도록
  window.location.replace(url.toString());
}

const ko = {
  htmlLang: "ko",
  docTitle: "높이 높이 · Higher Higher",
  docDesc:
    "무너지기 전까지, 더 높이. 랜덤 블록을 물리로 쌓아 최고 높이에 도전하는 밸런스 게임.",

  brand: "높이 높이",
  brandSub: "HIGHER HIGHER",
  tagline: "무너지기 전까지, 더 높이",
  intro: "블록을 하나씩 쌓아 최고 높이 기록에 도전하세요.",

  modeBasic: "기본 모드",
  modeBasicBadge: "쉬움",
  modeBasicDesc: "정사각형만",
  modeRandom: "도전 모드",
  modeRandomBadge: "랜덤",
  modeRandomDesc: "모양이 매번 바뀜",
  modeShort: { basic: "기본", random: "도전" } as Record<string, string>,
  noRecord: "아직 기록 없음",
  myBest: (m: string, b: number) => `내 최고 ${m}m · ${b}블록`,

  leaderboard: "글로벌 랭킹",
  soundToggle: "소리 켜기/끄기",
  close: "닫기",

  hudHeight: "높이",
  hudNext: "다음",
  hudBlocks: "블록",
  hudBest: (mode: string, m: string, b: number) => `${mode} · 최고 ${m}m · ${b}블록`,
  wobbling: "휘청거려요!",
  drop: "떨어뜨리기",
  rotateCcw: "반시계 회전",
  rotateCw: "시계 회전",
  controlHint: "블록이 좌우로 왕복해요 · 탭 / 스페이스로 드롭 · ↺↻ 회전",

  fellTitle: "탑이 무너졌어요",
  fellSub: "균형을 잃고 와르르…",
  clearTitle: "완주 성공!",
  clearSub: "100블록을 모두 쌓았어요",
  statHeight: "도달 높이",
  statBlocks: "블록",
  bestLine: (mode: string, m: string, b: number) => `${mode} 최고 ${m}m · ${b}블록`,
  newRecord: "신기록",

  submitPrompt: "글로벌 랭킹에 기록을 남겨보세요",
  nickname: "닉네임",
  submit: "등록",
  submitting: "등록 중…",
  submitFailed: "등록에 실패했어요. 잠시 후 다시 시도해주세요.",
  myRank: "내 순위",
  ofTotal: (n: number) => `/ 총 ${n}명`,
  anonymous: "익명",

  playAgain: "다시 하기",
  share: "공유하기",
  copied: "복사됨",
  makeCard: "결과 카드 만들기",
  saveCard: "결과 카드 저장 / 공유",
  resultCard: "결과 카드",
  home: "홈으로",

  shareText: (m: string, b: number) =>
    `높이 높이에서 ${m}m · ${b}블록 쌓았어요! 🧱 도전해보세요`,
  shareCardText: "내 탑 기록!",

  rankSearchPlaceholder: "닉네임으로 내 순위 찾기",
  rankSearchLabel: "랭킹 검색",
  clearSearch: "검색어 지우기",
  searching: "검색 중…",
  noSearchHit: (q: string) => `“${q}” 기록을 찾지 못했어요`,
  loadFailed: "랭킹을 불러오지 못했어요",
  loading: "불러오는 중…",
  noRecordsYet: "아직 기록이 없어요. 첫 주자가 되어보세요!",
  blocksCount: (n: number) => `${n}블록`,
  topOnly: (n: number) => `상위 ${n}위까지 표시돼요 · 그 아래 순위는 검색으로 찾아보세요`,
  rankNth: (n: number) => `${n}위`,
  towerOf: (name: string) => `${name}의 탑`,
  towerLoadFailed: "탑 이미지를 불러오지 못했어요",

  // 결과 카드(캔버스)
  cardClear: "완주 성공!",
  cardResult: "기록",
  cardBlocks: (n: number, total: number) => `블록 ${n} / ${total}`,
  cardBrand: "높이 높이 · Higher Higher",

  // /stats
  statsTitle: "이용 통계",
  statsLoadFailed: "통계를 불러오지 못했어요",
  statsEmpty: "아직 기록이 없어요",
  statsTodayVisitors: "오늘 방문자",
  statsTodayGames: "오늘 판수",
  statsPerSession: "세션당 판수",
  statsPerSessionSub: "기간 내 · 방문 1회당",
  statsScores: "등록된 기록",
  statsWeekly: "주별",
  statsDaily: "일별",
  statsAsChart: "그래프로",
  statsAsTable: "표로",
  statsVisitors: "방문자",
  statsGames: "판수",
  statsWeekOf: "주 시작",
  statsDate: "날짜",
  statsStarts: "시작",
  statsEnds: "완료",
  statsSubmits: "등록",
  statsAds: "광고",
  statsFillRate: "응답률",
  statsFillRateSub: "광고가 채워진 비율(%)",
  statsFilled: "채워짐",
  statsEmptyAd: "빈 응답",
  statsFunnel: "단계별 횟수",
  statsVisit: "방문",
  statsGameStart: "게임 시작",
  statsGameEnd: "게임 종료",
  statsRankSubmit: "랭킹 등록",
  statsShare: "공유",
  statsByMode: "모드별",
  statsMode: "모드",
  statsAvgHeight: "평균 높이",
  statsAvgBlocks: "평균 블록",
  statsAvgTime: "평균 시간",
  statsBackToGame: "게임으로",
  statsKst: "한국 시간 기준",
  statsWeeklyNote: "기간이 길어 주 단위로 묶었어요 (각 주의 월요일 날짜)",
  statsPeak: (max: number, v: number, g: number) => `최대 ${max} · 마지막 날 방문자 ${v} · 판수 ${g}`,
  statsAdAvgSec: (sec: number) => `채워질 때 평균 ${sec}초 걸려요`,
  statsRange: { "7": "7일", "14": "14일", "30": "30일", "90": "90일", "365": "1년" } as Record<string, string>,

  switchTo: "English",
};

// as const 를 쓰면 각 값이 리터럴 타입("기본" 등)이 되어 영어 번역을 대입할 수 없다.
// 그냥 두면 string 으로 넓어지고, en 쪽에서 키 누락·오타를 타입 검사로 잡아 준다.
type Strings = typeof ko;

/** 1 이면 단수. "1 blocks" 를 막는다. */
const plural = (n: number) => (n === 1 ? "" : "s");

const en: Strings = {
  htmlLang: "en",
  docTitle: "Higher Higher · Stack the blocks",
  docDesc:
    "Stack until it falls. A physics balance game — drop random blocks and push your tower as high as it goes.",

  brand: "Higher Higher",
  brandSub: "PHYSICS STACKING GAME",
  tagline: "Stack it until it falls",
  intro: "Drop the blocks one by one and go for your tallest tower.",

  modeBasic: "Classic",
  modeBasicBadge: "Easy",
  modeBasicDesc: "Squares only",
  modeRandom: "Challenge",
  modeRandomBadge: "Random",
  modeRandomDesc: "Shape changes each time",
  modeShort: { basic: "Classic", random: "Challenge" },
  noRecord: "No record yet",
  myBest: (m: string, b: number) => `Best ${m}m · ${b} block${plural(b)}`,

  leaderboard: "Leaderboard",
  soundToggle: "Toggle sound",
  close: "Close",

  hudHeight: "Height",
  hudNext: "Next",
  hudBlocks: "Blocks",
  hudBest: (mode: string, m: string, b: number) =>
    `${mode} · best ${m}m · ${b} block${plural(b)}`,
  wobbling: "Wobbling!",
  drop: "Drop",
  rotateCcw: "Rotate counter-clockwise",
  rotateCw: "Rotate clockwise",
  controlHint: "The block swings · Tap / Space to drop · ↺↻ to rotate",

  fellTitle: "Your tower fell",
  fellSub: "Lost its balance and down it went…",
  clearTitle: "You made it!",
  clearSub: "All 100 blocks stacked",
  statHeight: "Height",
  statBlocks: "Blocks",
  bestLine: (mode: string, m: string, b: number) =>
    `${mode} best ${m}m · ${b} block${plural(b)}`,
  newRecord: "Record",

  submitPrompt: "Put your score on the leaderboard",
  nickname: "Nickname",
  submit: "Submit",
  submitting: "Submitting…",
  submitFailed: "Couldn’t submit. Please try again in a moment.",
  myRank: "Your rank",
  ofTotal: (n: number) => `/ of ${n}`,
  anonymous: "Anonymous",

  playAgain: "Play again",
  share: "Share",
  copied: "Copied",
  makeCard: "Create result card",
  saveCard: "Save / share card",
  resultCard: "Result card",
  home: "Home",

  shareText: (m: string, b: number) =>
    `I stacked ${m}m · ${b} block${plural(b)} in Higher Higher! 🧱 Give it a go`,
  shareCardText: "My tower!",

  rankSearchPlaceholder: "Find your rank by nickname",
  rankSearchLabel: "Search leaderboard",
  clearSearch: "Clear search",
  searching: "Searching…",
  noSearchHit: (q: string) => `No record found for “${q}”`,
  loadFailed: "Couldn’t load the leaderboard",
  loading: "Loading…",
  noRecordsYet: "No records yet. Be the first!",
  blocksCount: (n: number) => `${n} block${plural(n)}`,
  topOnly: (n: number) => `Top ${n} shown · search to find lower ranks`,
  rankNth: (n: number) => `#${n}`,
  towerOf: (name: string) => `${name}’s tower`,
  towerLoadFailed: "Couldn’t load the tower image",

  cardClear: "You made it!",
  cardResult: "Result",
  cardBlocks: (n: number, total: number) => `Blocks ${n} / ${total}`,
  cardBrand: "Higher Higher",

  statsTitle: "Usage stats",
  statsLoadFailed: "Couldn’t load the stats",
  statsEmpty: "No data yet",
  statsTodayVisitors: "Visitors today",
  statsTodayGames: "Games today",
  statsPerSession: "Games per session",
  statsPerSessionSub: "in range · per visit",
  statsScores: "Scores submitted",
  statsWeekly: "Weekly",
  statsDaily: "Daily",
  statsAsChart: "Chart",
  statsAsTable: "Table",
  statsVisitors: "Visitors",
  statsGames: "Games",
  statsWeekOf: "Week of",
  statsDate: "Date",
  statsStarts: "Started",
  statsEnds: "Finished",
  statsSubmits: "Submitted",
  statsAds: "Ads",
  statsFillRate: "Fill rate",
  statsFillRateSub: "share of filled ad requests (%)",
  statsFilled: "Filled",
  statsEmptyAd: "Empty",
  statsFunnel: "Funnel",
  statsVisit: "Visit",
  statsGameStart: "Game start",
  statsGameEnd: "Game end",
  statsRankSubmit: "Score submit",
  statsShare: "Share",
  statsByMode: "By mode",
  statsMode: "Mode",
  statsAvgHeight: "Avg height",
  statsAvgBlocks: "Avg blocks",
  statsAvgTime: "Avg time",
  statsBackToGame: "Back to game",
  statsKst: "KST",
  statsWeeklyNote: "Grouped by week for this range (date = that week’s Monday)",
  statsPeak: (max: number, v: number, g: number) =>
    `Peak ${max} · last day ${v} visitor${plural(v)} · ${g} game${plural(g)}`,
  statsAdAvgSec: (sec: number) => `Takes ${sec}s on average to fill`,
  statsRange: { "7": "7d", "14": "14d", "30": "30d", "90": "90d", "365": "1y" },

  switchTo: "한국어",
};

export const t: Strings = lang === "ko" ? ko : en;

/** 문서 언어와 제목·설명을 고른 언어에 맞춘다. main.tsx 에서 한 번 호출. */
export function applyDocumentLang(): void {
  document.documentElement.lang = t.htmlLang;
  document.title = t.docTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", t.docDesc);
}
