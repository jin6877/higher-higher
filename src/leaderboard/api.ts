// 글로벌 랭킹 클라이언트 — higher-higher 전용 백엔드(server/)와 통신한다.
// 운영: 게임 정적파일과 API 를 같은 컨테이너가 서빙(higher.brag.io.kr) → 같은 오리진, CORS 불필요.
// 로컬 개발: vite.config 의 dev 프록시가 /api → localhost:8080(로컬 서버)로 넘긴다.
// 어느 환경이든 실패하면 게임 자체는 그대로 동작하고 랭킹 UI 만 비활성/에러 상태가 된다.

const API_BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/+$/, "");

export interface ScoreEntry {
  id: number;
  rank: number;
  playerName: string;
  heightCm: number;
  blocks: number;
  createdAt: string;
  /** 이 기록에 쌓은 탑 스냅샷 이미지가 저장돼 있는지 (있으면 클릭 시 상세 탑을 볼 수 있다). */
  hasImage: boolean;
}

/** 특정 기록의 탑 이미지 URL. */
export function towerImageUrl(id: number): string {
  return `${API_BASE}/scores/${id}/tower.png`;
}

export interface SubmitResult {
  rank: number;
  totalCount: number;
  entry: ScoreEntry;
  top: ScoreEntry[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

/** 미터(float) → 서버 저장용 cm(정수). */
export function toHeightCm(meters: number): number {
  return Math.max(0, Math.round(meters * 100));
}

/** 서버 cm(정수) → 표시용 미터 문자열(소수 1자리). */
export function heightCmToM(cm: number): string {
  return (cm / 100).toFixed(1);
}

export async function fetchLeaderboard(limit = 20): Promise<ScoreEntry[]> {
  const res = await fetch(`${API_BASE}/scores?limit=${limit}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  const body = (await res.json()) as ApiResponse<{ top: ScoreEntry[] }>;
  if (!body.success || !body.data) throw new Error(body.error?.message ?? "failed");
  return body.data.top;
}

export async function submitScore(input: {
  playerName: string;
  heightCm: number;
  blocks: number;
  /** 탑 스냅샷 (data:image/png;base64,...) — 있으면 서버가 저장해 랭킹에서 상세로 보여준다. */
  image?: string;
}): Promise<SubmitResult> {
  const res = await fetch(`${API_BASE}/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => null)) as ApiResponse<SubmitResult> | null;
  if (!res.ok || !body?.success || !body.data) {
    throw new Error(body?.error?.message ?? `submit ${res.status}`);
  }
  return body.data;
}

const NAME_KEY = "hh_player_name";

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* localStorage 불가(사파리 프라이빗 등) — 무시 */
  }
}
