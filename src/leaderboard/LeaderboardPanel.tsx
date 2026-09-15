import { useEffect, useState } from "react";
import { fetchLeaderboard, heightCmToM, type ScoreEntry } from "./api";

/**
 * Top N 랭킹 리스트. preload 가 있으면(제출 직후 받은 Top N) 그걸 그대로 그리고,
 * 없으면 마운트 시 서버에서 받아온다. 실패해도 조용히 에러 문구만 — 게임엔 영향 없음.
 * 사용자 입력 닉네임은 React 텍스트({s.playerName})로 렌더돼 자동 이스케이프된다(XSS 안전).
 */
export function LeaderboardList({
  preload,
  highlightName,
  limit = 10,
}: {
  preload?: ScoreEntry[];
  highlightName?: string;
  limit?: number;
}) {
  const [rows, setRows] = useState<ScoreEntry[] | null>(preload ?? null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (preload) {
      setRows(preload);
      return;
    }
    let alive = true;
    fetchLeaderboard(limit)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [preload, limit]);

  if (err)
    return <p className="py-5 text-center text-sm text-white/40">랭킹을 불러오지 못했어요</p>;
  if (!rows)
    return <p className="py-5 text-center text-sm text-white/40">불러오는 중…</p>;
  if (rows.length === 0)
    return (
      <p className="py-5 text-center text-sm text-white/40">
        아직 기록이 없어요. 첫 주자가 되어보세요! 🚀
      </p>
    );

  // 1위 높이를 기준(100%)으로 각 순위의 미니 타워 높이를 비례 계산 (rows 는 높이 내림차순).
  const maxCm = rows.length ? rows[0].heightCm : 0;

  return (
    <ol className="space-y-1.5">
      {rows.slice(0, limit).map((s, i) => {
        const mine = !!highlightName && s.playerName === highlightName;
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${s.rank}`;
        return (
          <li
            key={`${s.rank}-${i}`}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left ${
              mine ? "bg-[#FFD166]/20 ring-1 ring-[#FFD166]/50" : "bg-white/5"
            }`}
          >
            <span className="w-7 shrink-0 text-center text-sm font-bold tabular-nums text-white/70">
              {medal}
            </span>
            <MiniTower ratio={maxCm > 0 ? s.heightCm / maxCm : 0} />
            <span className="flex-1 truncate text-sm font-semibold">{s.playerName}</span>
            <span className="shrink-0 text-sm font-extrabold tabular-nums text-[#FFD166]">
              {heightCmToM(s.heightCm)}m
            </span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/45">
              {s.blocks}블록
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// 게임 블록을 연상시키는 팔레트 — 아래(따뜻)에서 위(밝게)로 쌓인다.
const BRICK_COLORS = [
  "#FF6B9D",
  "#FFD166",
  "#4ECDC4",
  "#A78BFA",
  "#F59E0B",
  "#38BDF8",
];

/** 점수(높이) 비례 미니 블록 타워. ratio 0~1 → 1~6칸을 아래부터 쌓아 올린다. */
function MiniTower({ ratio }: { ratio: number }) {
  const bricks = Math.max(1, Math.min(6, Math.round(ratio * 6)));
  return (
    <div
      className="flex h-8 w-4 shrink-0 flex-col-reverse items-center gap-[2px]"
      aria-hidden
    >
      {Array.from({ length: bricks }).map((_, i) => (
        <div
          key={i}
          className="w-full rounded-[2px] shadow-sm"
          style={{ height: 4, background: BRICK_COLORS[i % BRICK_COLORS.length] }}
        />
      ))}
    </div>
  );
}
