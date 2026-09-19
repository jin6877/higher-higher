import { useEffect, useState } from "react";

/**
 * 이용 통계 (/stats) — 누구나 볼 수 있는 공개 페이지.
 * 서버가 집계값만 내려주므로 개별 로그(IP·브라우저·세션)는 여기 오지 않는다.
 *
 * 색: 게임 강조색(핑크·골드)의 어두운 배경용 단계. 두 계열의 색 구분도는 검증 스크립트로
 * 확인했고(색각 이상 기준 통과), 색만으로 구분하지 않도록 범례와 값 라벨을 함께 둔다.
 */
const VISITOR = "#d55181";
const GAMES = "#c98500";

interface Stats {
  daily: { day: string; visitors: number; starts: number; ends: number; submits: number }[];
  byMode: { mode: string; games: number; avgHeightM: number; avgBlocks: number; avgSec: number; submits: number }[];
  funnel: { visits: number; starts: number; ends: number; submits: number; shares: number };
  totals: { todayVisitors: number; todayGames: number; gamesPerSession: number; scores: number };
}

const MODE_LABEL: Record<string, string> = { basic: "기본", random: "도전" };
const API_BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/+$/, "");

export function StatsPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/stats`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => setData(b.data as Stats))
      .catch(() => setErr(true));
  }, []);

  if (err) {
    return <Shell><p className="py-10 text-center text-white/50">통계를 불러오지 못했어요</p></Shell>;
  }
  if (!data) {
    return <Shell><p className="py-10 text-center text-white/40">불러오는 중…</p></Shell>;
  }

  const { daily, byMode, funnel, totals } = data;
  const max = Math.max(1, ...daily.flatMap((d) => [d.visitors, d.ends]));
  const last = daily[daily.length - 1];
  const funnelMax = Math.max(1, ...Object.values(funnel));

  return (
    <Shell>
      {/* 요약 — 하나짜리 숫자는 차트로 그릴 게 아니라 그대로 크게 보여준다 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="오늘 방문자" value={totals.todayVisitors} />
        <Tile label="오늘 판수" value={totals.todayGames} />
        <Tile label="세션당 판수" value={totals.gamesPerSession} hint="한 번 들어와 평균 몇 판" />
        <Tile label="등록된 기록" value={totals.scores} />
      </div>

      <Section
        title="최근 14일"
        right={
          <button
            onClick={() => setAsTable((v) => !v)}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/70 transition hover:bg-white/20"
          >
            {asTable ? "그래프로" : "표로"}
          </button>
        }
      >
        <div className="mb-3 flex gap-4 text-[11px] font-semibold text-white/60">
          <Legend color={VISITOR} label="방문자" />
          <Legend color={GAMES} label="판수" />
        </div>

        {daily.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">아직 기록이 없어요</p>
        ) : asTable ? (
          <Table
            head={["날짜", "방문자", "시작", "완료", "등록"]}
            rows={daily.map((d) => [d.day.slice(5), d.visitors, d.starts, d.ends, d.submits])}
          />
        ) : (
          <>
            <div className="flex h-44 items-end gap-[3px]">
              {daily.map((d) => (
                <div key={d.day} className="group relative flex h-full flex-1 items-end gap-[2px]">
                  <Bar value={d.visitors} max={max} color={VISITOR} />
                  <Bar value={d.ends} max={max} color={GAMES} />
                  {/* 막대마다 마우스를 올리면 값 — 모든 점에 숫자를 달지 않기 위해 */}
                  <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-[#0b1026] px-2 py-1 text-[11px] font-semibold shadow-lg ring-1 ring-white/15 group-hover:block">
                    <div className="text-white/50">{d.day.slice(5)}</div>
                    <div style={{ color: VISITOR }}>방문자 {d.visitors}</div>
                    <div style={{ color: GAMES }}>판수 {d.ends}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[11px] font-medium text-white/40">
              <span>{daily[0].day.slice(5)}</span>
              {last && (
                <span className="tabular-nums">
                  최대 {max} · 마지막 날 방문자 {last.visitors} · 판수 {last.ends}
                </span>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="단계별 횟수 (전체 기간)">
        {/* 같은 단위(횟수)라 한 축의 가로 막대로 비교한다. 한 번 방문해 여러 판을 하므로
            시작·종료가 방문보다 클 수 있다 — 기준은 방문 수가 아니라 가장 큰 값이다. */}
        <div className="space-y-2">
          {[
            ["방문", funnel.visits],
            ["게임 시작", funnel.starts],
            ["게임 종료", funnel.ends],
            ["랭킹 등록", funnel.submits],
            ["공유", funnel.shares],
          ].map(([label, v]) => (
            <div key={label as string} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-white/55">{label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-r-[4px] bg-white/5">
                <div
                  className="h-full rounded-r-[4px]"
                  style={{
                    width: `${Math.max(1, ((v as number) / funnelMax) * 100)}%`,
                    background: VISITOR,
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums">{v as number}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="모드별">
        {/* 판수·높이·시간은 단위가 달라 한 그래프에 겹치지 않고 표로 둔다 */}
        {byMode.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/40">아직 기록이 없어요</p>
        ) : (
          <Table
            head={["모드", "판수", "평균 높이", "평균 블록", "평균 시간", "등록"]}
            rows={byMode.map((m) => [
              MODE_LABEL[m.mode] ?? m.mode,
              m.games,
              `${m.avgHeightM}m`,
              m.avgBlocks,
              `${m.avgSec}초`,
              m.submits,
            ])}
          />
        )}
      </Section>

      <p className="mt-6 text-center text-[11px] text-white/30">
        날짜는 한국 시간 기준 · <a href="/" className="underline hover:text-white/60">게임으로</a>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-[#0b1026] px-4 pb-10 pt-[max(1.5rem,calc(env(safe-area-inset-top,0px)+1rem))] text-white">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="mb-4 text-xl font-black tracking-tight">📊 이용 통계</h1>
        {children}
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl bg-white/[0.06] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-white/80">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] px-3 py-3">
      <div className="text-[11px] font-semibold text-white/50">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] font-medium text-white/35">{hint}</div>}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

/** 막대 — 바닥에 붙고 끝만 둥글게. 값이 0이어도 1px 은 남겨 "없음"이 보이게 한다. */
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div
      className="flex-1 rounded-t-[4px]"
      style={{ height: `${Math.max(value > 0 ? 3 : 1, (value / max) * 100)}%`, background: color }}
    />
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-white/45">
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-semibold tabular-nums">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-3 whitespace-nowrap">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
