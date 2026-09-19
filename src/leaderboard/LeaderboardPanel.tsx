import { useEffect, useState } from "react";
import {
  fetchLeaderboard,
  heightCmToM,
  searchScores,
  towerImageUrl,
  type ScoreEntry,
} from "./api";

/**
 * Top N 랭킹 리스트. preload 가 있으면(제출 직후 받은 Top N) 그걸 그대로 그리고,
 * 없으면 마운트 시 서버에서 받아온다. 실패해도 조용히 에러 문구만 — 게임엔 영향 없음.
 * 사용자 입력 닉네임은 React 텍스트({s.playerName})로 렌더돼 자동 이스케이프된다(XSS 안전).
 *
 * searchable 이면 닉네임 검색창이 붙는다. 목록엔 Top N 까지만 노출하고, 그 아래 순위는
 * 검색으로만 찾을 수 있다 — 검색 결과에는 전체 랭킹 기준의 실제 순위가 표시된다.
 */
export function LeaderboardList({
  preload,
  highlightName,
  limit = 10,
  searchable = false,
}: {
  preload?: ScoreEntry[];
  highlightName?: string;
  limit?: number;
  searchable?: boolean;
}) {
  const [rows, setRows] = useState<ScoreEntry[] | null>(preload ?? null);
  const [err, setErr] = useState(false);
  const [selected, setSelected] = useState<ScoreEntry | null>(null);

  const [query, setQuery] = useState("");
  // 결과를 "어떤 검색어의 결과인지"와 함께 들고 있는다. 그래야 검색 중 상태를 따로
  // 저장하지 않고 파생시킬 수 있고, 타이핑 중에 이전 검색어의 결과가 비치지 않는다.
  const [results, setResults] = useState<{ q: string; rows: ScoreEntry[] } | null>(null);

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

  // 입력이 멈춘 뒤(300ms) 검색. 검색어를 비우면 다시 Top N 목록으로 돌아간다.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const t = setTimeout(() => {
      searchScores(q, 20)
        .then((r) => alive && setResults({ q, rows: r }))
        .catch(() => alive && setResults({ q, rows: [] }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  const q = query.trim();
  const isSearch = q.length > 0;
  const hits = results?.q === q ? results.rows : null; // 현재 검색어의 결과만 유효
  const searching = isSearch && hits === null;
  // 미니 타워 비율은 어느 모드에서든 전체 1위 높이를 100% 기준으로 삼아야 비교가 된다.
  const maxCm = rows?.length ? rows[0].heightCm : (hits?.[0]?.heightCm ?? 0);
  const shown = isSearch ? hits : rows?.slice(0, limit);

  const search = searchable && (
    <div className="relative mb-2.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        maxLength={20}
        placeholder="닉네임으로 내 순위 찾기"
        aria-label="랭킹 검색"
        className="w-full rounded-xl bg-white/10 py-2.5 pl-9 pr-9 text-sm font-semibold text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-[#FFD166]/50"
      />
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">
        🔍
      </span>
      {query && (
        <button
          onClick={() => setQuery("")}
          aria-label="검색어 지우기"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-xs text-white/60 transition hover:bg-white/20"
        >
          ✕
        </button>
      )}
    </div>
  );

  let body;
  if (searching) {
    body = <p className="py-5 text-center text-sm text-white/40">검색 중…</p>;
  } else if (isSearch && shown?.length === 0) {
    body = (
      <p className="py-5 text-center text-sm text-white/40">
        &ldquo;{q}&rdquo; 기록을 찾지 못했어요
      </p>
    );
  } else if (!isSearch && err) {
    body = <p className="py-5 text-center text-sm text-white/40">랭킹을 불러오지 못했어요</p>;
  } else if (!shown) {
    body = <p className="py-5 text-center text-sm text-white/40">불러오는 중…</p>;
  } else if (shown.length === 0) {
    body = (
      <p className="py-5 text-center text-sm text-white/40">
        아직 기록이 없어요. 첫 주자가 되어보세요! 🚀
      </p>
    );
  } else {
    body = (
      <ol className="space-y-1.5">
        {shown.map((s, i) => {
          const mine = !!highlightName && s.playerName === highlightName;
          // 메달은 목록 위치가 아니라 실제 순위 기준 — 검색 결과의 57위가 금메달을 달면 안 된다.
          const medal =
            s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : `${s.rank}`;
          const clickable = s.hasImage;
          return (
            <li key={`${s.id}-${i}`}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setSelected(s)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${
                  mine ? "bg-[#FFD166]/20 ring-1 ring-[#FFD166]/50" : "bg-white/5"
                } ${clickable ? "cursor-pointer hover:bg-white/12 active:scale-[0.99]" : "cursor-default"}`}
              >
                <span className="w-7 shrink-0 text-center text-sm font-bold tabular-nums text-white/70">
                  {medal}
                </span>
                <MiniTower ratio={maxCm > 0 ? s.heightCm / maxCm : 0} />
                <span className="flex-1 truncate text-sm font-semibold">
                  {s.playerName}
                  {clickable && <span className="ml-1.5 text-xs text-white/35">🗼</span>}
                </span>
                <span className="shrink-0 text-sm font-extrabold tabular-nums text-[#FFD166]">
                  {heightCmToM(s.heightCm)}m
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/45">
                  {s.blocks}블록
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <>
      {search}
      {body}
      {searchable && !isSearch && rows && rows.length >= limit && (
        <p className="mt-2.5 text-center text-[11px] font-medium text-white/35">
          상위 {limit}위까지 표시돼요 · 그 아래 순위는 검색으로 찾아보세요
        </p>
      )}
      {selected && <TowerDetail entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/** 클릭한 기록의 실제 쌓은 탑 스냅샷을 크게 보여주는 오버레이. */
function TowerDetail({ entry, onClose }: { entry: ScoreEntry; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="pointer-events-auto relative flex max-h-full w-full max-w-xs flex-col items-center">
        <div className="mb-2 flex w-full items-center justify-between px-1">
          <div className="min-w-0">
            <div className="truncate text-base font-black">{entry.playerName}</div>
            <div className="text-xs font-semibold text-white/55">
              <span className="text-[#FFD166]">{heightCmToM(entry.heightCm)}m</span> ·{" "}
              {entry.blocks}블록 · {entry.rank}위
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        {failed ? (
          <div className="flex h-64 w-full items-center justify-center rounded-2xl bg-white/5 text-sm text-white/40">
            탑 이미지를 불러오지 못했어요
          </div>
        ) : (
          <img
            src={towerImageUrl(entry.id)}
            alt={`${entry.playerName}의 탑`}
            onError={() => setFailed(true)}
            className="max-h-[80vh] w-auto rounded-2xl border border-white/10 shadow-2xl"
          />
        )}
      </div>
    </div>
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
