// 이용 로그 — 몇 명이 들어와 몇 판을 했는지 보기 위한 최소한의 기록.
// 실패는 전부 무시한다. 광고 차단기나 오프라인에서도 게임은 그대로 돌아가야 한다.

import type { GameMode } from "./game/types";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/+$/, "");
const SESSION_KEY = "hh_session";

/** 탭 단위 임시 id. 브라우저를 닫으면 사라진다 — 사람을 계속 추적하려는 값이 아니다. */
function sessionId(): string {
  try {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch {
    return "";
  }
}

export type EventName =
  | "visit" | "start" | "end" | "submit" | "share" | "rank"
  | "ad_fill" | "ad_empty";

export function logEvent(
  name: EventName,
  data: { mode?: GameMode; heightCm?: number; blocks?: number; durationMs?: number } = {},
): void {
  try {
    const body = JSON.stringify({ name, session: sessionId(), ...data });
    // sendBeacon 은 페이지를 떠나는 중에도 전송이 보장된다(결과 화면 이탈 등).
    if (navigator.sendBeacon?.(`${API_BASE}/events`, new Blob([body], { type: "application/json" }))) {
      return;
    }
    void fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 로그는 게임에 영향을 주지 않는다 */
  }
}
