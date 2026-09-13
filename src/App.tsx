import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "./game/engine";
import * as SFX from "./game/audio";
import { formatHeight } from "./game/logic";
import { dimLabel } from "./game/dimensions";
import type { HudState, ShapeKind } from "./game/types";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current, setHud);
    gameRef.current = g;
    const onResize = () => g.resize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      g.destroy();
    };
  }, []);

  // Show the result modal a beat after collapse/clear so the animation reads.
  useEffect(() => {
    if (!hud) return;
    if (hud.phase === "gameover" || hud.phase === "clear") {
      const t = setTimeout(() => setShowModal(true), hud.phase === "clear" ? 400 : 850);
      return () => clearTimeout(t);
    }
    setShowModal(false);
    setCard(null);
  }, [hud?.phase]);

  const start = useCallback(() => gameRef.current?.start(), []);
  const reset = useCallback(() => {
    setCard(null);
    setShowModal(false);
    gameRef.current?.reset();
  }, []);
  const home = useCallback(() => {
    setCard(null);
    setShowModal(false);
    gameRef.current?.goHome();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      SFX.setMuted(next);
      return next;
    });
  }, []);

  const makeCard = useCallback(() => {
    const url = gameRef.current?.captureScoreCard();
    if (url) setCard(url);
  }, []);

  const shareCard = useCallback(async () => {
    const url = card ?? gameRef.current?.captureScoreCard();
    if (!url) return;
    if (!card) setCard(url);
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], "higher-higher.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "높이 높이", text: "내 탑 기록!" });
        return;
      }
    } catch {
      /* fall through to download */
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = "higher-higher.png";
    a.click();
  }, [card]);

  const phase = hud?.phase ?? "home";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b1026] text-white select-none">
      <canvas ref={canvasRef} className="absolute inset-0 block touch-none" />

      {/* top scrim for legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/40 to-transparent" />

      {/* mute button */}
      <button
        onClick={toggleMute}
        className="pointer-events-auto absolute right-3 top-3 z-30 grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20 active:scale-95"
        aria-label="소리 켜기/끄기"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* ================= HUD (playing) ================= */}
      {phase === "playing" && hud && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-4">
            <div className="mx-auto flex max-w-md items-start justify-between gap-3">
              <div className="rounded-2xl bg-black/30 px-4 py-2 backdrop-blur-md">
                <div className="text-[11px] font-semibold tracking-wide text-white/60">높이</div>
                <div className="text-3xl font-extrabold leading-none tabular-nums">
                  {formatHeight(hud.heightM)}
                  <span className="ml-0.5 text-lg font-bold text-white/70">m</span>
                </div>
              </div>

              {/* next-block preview */}
              <div className="flex flex-col items-center rounded-2xl bg-black/30 px-3 py-1.5 backdrop-blur-md">
                <div className="text-[10px] font-semibold tracking-wide text-white/55">다음</div>
                <div className="mt-0.5 grid h-9 w-9 place-items-center">
                  {hud.next ? (
                    <ShapePreview kind={hud.next.kind} color={hud.next.color} />
                  ) : (
                    <div className="h-6 w-6 rounded-md bg-white/10" />
                  )}
                </div>
                {hud.next && (
                  <div className="mt-0.5 text-[10px] font-bold leading-none tabular-nums text-white/75">
                    {dimLabel(hud.next)}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-black/30 px-4 py-2 text-right backdrop-blur-md">
                <div className="text-[11px] font-semibold tracking-wide text-white/60">블록</div>
                <div className="text-3xl font-extrabold leading-none tabular-nums">
                  {hud.placed}
                  <span className="text-lg font-bold text-white/50">/{hud.total}</span>
                </div>
              </div>
            </div>
            {/* progress */}
            <div className="mx-auto mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FFD166] to-[#FF6B9D] transition-[width] duration-300"
                style={{ width: `${(hud.placed / hud.total) * 100}%` }}
              />
            </div>
            <div className="mx-auto mt-1 max-w-md text-center text-[11px] font-medium text-white/45">
              최고 {formatHeight(hud.bestM)}m · {hud.bestBlocks}블록
            </div>
          </div>

          {/* wobble warning */}
          {hud.wobble > 0.28 && (
            <div className="pointer-events-none absolute inset-x-0 top-32 z-20 flex justify-center">
              <div className="animate-pulse rounded-full bg-red-500/85 px-4 py-1.5 text-sm font-bold shadow-lg">
                ⚠ 휘청거려요!
              </div>
            </div>
          )}

          {/* controls */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-md items-center justify-center gap-3">
              <button
                onClick={() => gameRef.current?.rotate(-1)}
                className="pointer-events-auto grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/12 text-2xl backdrop-blur-md transition hover:bg-white/20 active:scale-95"
                aria-label="반시계 회전"
              >
                ↺
              </button>
              <button
                onClick={() => gameRef.current?.drop()}
                className="pointer-events-auto h-14 flex-1 rounded-2xl bg-gradient-to-r from-[#FF6B9D] to-[#FFD166] text-lg font-extrabold text-[#2a0f28] shadow-lg shadow-pink-500/20 transition hover:brightness-110 active:scale-[0.98]"
              >
                떨어뜨리기
              </button>
              <button
                onClick={() => gameRef.current?.rotate(1)}
                className="pointer-events-auto grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/12 text-2xl backdrop-blur-md transition hover:bg-white/20 active:scale-95"
                aria-label="시계 회전"
              >
                ↻
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] font-medium text-white/40">
              블록이 좌우로 왕복해요 · 탭 / 스페이스로 드롭 · ↺↻ 회전
            </p>
          </div>
        </>
      )}

      {/* ================= HOME / HERO ================= */}
      {phase === "home" && (
        <div className="absolute inset-0 z-20 flex flex-col">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0b1026]/55 via-transparent to-[#0b1026]/80" />
          <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="animate-[rise_0.7s_ease-out] ">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-white/80 backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-[#06D6A0]" /> 물리 기반 블록 쌓기
              </div>
              <h1 className="bg-gradient-to-br from-white via-[#FFE7B0] to-[#FF9EC4] bg-clip-text text-6xl font-black leading-[0.95] tracking-tight text-transparent drop-shadow-[0_4px_20px_rgba(255,107,157,0.25)] sm:text-7xl">
                높이 높이
              </h1>
              <p className="mt-2 text-lg font-bold tracking-[0.35em] text-white/55">
                HIGHER HIGHER
              </p>
              <p className="mx-auto mt-5 max-w-sm text-base font-medium leading-relaxed text-white/75">
                무너지기 전까지, 더 높이. 랜덤 블록을 하나씩 쌓아 올려
                <br className="hidden sm:block" /> 최고 높이 기록에 도전하세요.
              </p>
            </div>

            <button
              onClick={start}
              className="pointer-events-auto mt-8 animate-[rise_0.9s_ease-out] rounded-2xl bg-gradient-to-r from-[#FF6B9D] to-[#FFD166] px-12 py-4 text-xl font-extrabold text-[#2a0f28] shadow-xl shadow-pink-500/25 transition hover:brightness-110 active:scale-95"
            >
              시작하기
            </button>

            {hud && hud.bestM > 0 && (
              <div className="pointer-events-none mt-5 rounded-2xl bg-black/25 px-5 py-2 text-sm font-semibold text-white/70 backdrop-blur-md">
                🏆 최고 기록 {formatHeight(hud.bestM)}m · {hud.bestBlocks}블록
              </div>
            )}
          </div>

          <div className="pointer-events-none relative mb-8 flex justify-center gap-5 px-6 text-center text-xs text-white/55">
            <Feat icon="🎯" label="타이밍 맞춰 드롭" />
            <Feat icon="🧱" label="랜덤 100블록" />
            <Feat icon="🌌" label="우주까지 상승" />
          </div>
        </div>
      )}

      {/* ================= RESULT MODAL ================= */}
      {(phase === "gameover" || phase === "clear") && showModal && hud && (
        <div className="absolute inset-0 z-30 flex items-center justify-center px-6">
          <div className="pointer-events-none absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div className="pointer-events-auto relative w-full max-w-sm animate-[pop-in_0.35s_ease-out] rounded-3xl border border-white/10 bg-[#12173a]/95 p-6 text-center shadow-2xl">
            <div className="text-5xl">{phase === "clear" ? "🏆" : "💥"}</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight">
              {phase === "clear" ? "완주 성공!" : "탑이 무너졌어요"}
            </h2>
            <p className="mt-1 text-sm text-white/60">
              {phase === "clear" ? "100블록을 모두 쌓았어요 🎉" : "균형을 잃고 와르르…"}
            </p>

            <div className="mt-5 flex gap-3">
              <Stat label="도달 높이" value={`${formatHeight(hud.peakM)}m`} />
              <Stat label="블록" value={`${hud.peakBlocks}/${hud.total}`} />
            </div>
            <div className="mt-3 rounded-2xl bg-white/5 py-2 text-sm font-semibold text-white/70">
              🏆 최고 {formatHeight(hud.bestM)}m · {hud.bestBlocks}블록
              {hud.peakM >= hud.bestM - 0.05 && hud.peakM > 0 && (
                <span className="ml-2 rounded-full bg-[#FFD166] px-2 py-0.5 text-[11px] font-bold text-[#3a2a00]">
                  신기록!
                </span>
              )}
            </div>

            {card && (
              <img
                src={card}
                alt="결과 카드"
                className="mt-4 w-full rounded-2xl border border-white/10 shadow-lg"
              />
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={reset}
                className="rounded-2xl bg-gradient-to-r from-[#FF6B9D] to-[#FFD166] py-3 font-extrabold text-[#2a0f28] transition hover:brightness-110 active:scale-95"
              >
                다시 하기
              </button>
              <button
                onClick={card ? shareCard : makeCard}
                className="rounded-2xl bg-white/12 py-3 font-bold text-white/90 backdrop-blur-md transition hover:bg-white/20 active:scale-95"
              >
                {card ? "저장 / 공유" : "결과 카드"}
              </button>
            </div>
            <button
              onClick={home}
              className="mt-3 text-sm font-semibold text-white/45 transition hover:text-white/70"
            >
              홈으로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Feat({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-xl backdrop-blur-md">
        {icon}
      </div>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-white/5 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-white/50">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

/** Mini glyph of the upcoming block's shape, in its actual colour. */
function ShapePreview({ kind, color }: { kind: ShapeKind; color: string }) {
  const stroke = "rgba(0,0,0,0.28)";
  const common = { fill: color, stroke, strokeWidth: 1.6, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 40 40" className="h-8 w-8" aria-label={`다음 블록: ${kind}`}>
      {kind === "square" && <rect x={9} y={9} width={22} height={22} rx={2} {...common} />}
      {kind === "rect" && <rect x={12} y={6} width={16} height={28} rx={2} {...common} />}
      {kind === "wide" && <rect x={4} y={14} width={32} height={12} rx={2} {...common} />}
      {kind === "trapezoid" && <polygon points="6,30 34,30 28,12 12,12" {...common} />}
      {kind === "lshape" && <polygon points="10,6 19,6 19,25 30,25 30,34 10,34" {...common} />}
      {kind === "tshape" && (
        <polygon points="6,8 34,8 34,16 24,16 24,34 16,34 16,16 6,16" {...common} />
      )}
      {kind === "circle" && <circle cx={20} cy={20} r={13} {...common} />}
      {kind === "semicircle" && <path d="M6,27 A14,14 0 0 1 34,27 Z" {...common} />}
      {kind === "poly" && <polygon points="20,5 32,13 32,27 20,35 8,27 8,13" {...common} />}
    </svg>
  );
}
