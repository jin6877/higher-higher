import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Game } from "./game/engine";
import * as SFX from "./game/audio";
import { formatHeight, loadRecord } from "./game/logic";
import { dimLabel } from "./game/dimensions";
import type { GameMode, HudState, ShapeKind } from "./game/types";
import { AdFit } from "./ads/AdFit";
import { logEvent } from "./analytics";
import { LeaderboardList } from "./leaderboard/LeaderboardPanel";
import {
  loadPlayerName,
  savePlayerName,
  submitScore,
  toHeightCm,
  type SubmitResult,
} from "./leaderboard/api";

type SubmitState = "idle" | "sending" | "done" | "error";

// 애드핏 광고 단위 — 결과 창에만 둔다. 게임 중에는 화면 어디를 탭해도 블록이 떨어지므로
// 광고를 두면 잘못 누른 클릭(무효 클릭)이 쌓인다.
const RESULT_AD_UNIT = "DAN-kFN7pcmVv6uh0UQ7"; // 320×100

// 결과 창이 뜬 뒤 '다시 하기' 를 누를 수 있게 되기까지. 광고가 유효 노출로 잡히려면
// 화면에 잠깐은 떠 있어야 해서 둔 최소한의 시간이다. 길게 잡으면 노출이 느는 게 아니라
// 이탈이 늘어 판수(=노출 수)가 줄어든다. 버튼은 자리에 둔 채 잠시 못 누르게만 한다.
// 반드시 AdFit 의 FAIL_MS(광고 미노출 시 빈 자리를 접는 시간)보다 길게 — 자리가 접히며
// 버튼이 움직이는 일이 '누를 수 있게 되기 전' 에 끝나야 잘못 누르지 않는다.
const RETRY_DELAY_MS = 2000;

const MODE_LABEL: Record<GameMode, string> = { basic: "기본", random: "도전" };

let visitLogged = false; // StrictMode 개발 모드의 두 번 마운트에서 방문이 두 번 찍히지 않게

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState(loadPlayerName());
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [showRanking, setShowRanking] = useState(false);
  // 랭킹 창에서 보고 있는 모드(게임 중인 모드와 별개로 둘러볼 수 있다)
  const [rankMode, setRankMode] = useState<GameMode>("random");
  const [shareCopied, setShareCopied] = useState(false);
  const homeTopRef = useRef<HTMLDivElement>(null);
  const homeBottomRef = useRef<HTMLDivElement>(null);
  const [retryLeft, setRetryLeft] = useState(0); // '다시 하기' 까지 남은 초 (0 이면 바로 가능)
  const retryUntil = useRef(0);
  const runStartedAt = useRef(0); // 한 판 길이 계산용

  // 세로 화면 홈: 제목 블록 아래 ~ 버튼 블록 위 빈칸을 엔진에 알려 데모 탑을 그 사이에 세운다.
  // offsetTop 을 쓰는 건 등장 애니메이션(transform)에 흔들리지 않는 레이아웃 위치가 필요해서.
  const syncHomeFrame = useCallback(() => {
    const g = gameRef.current;
    const top = homeTopRef.current;
    const bottom = homeBottomRef.current;
    if (!g || !top || !bottom) return;
    g.setHomeFrame(layoutTop(top) + top.offsetHeight, layoutTop(bottom));
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!visitLogged) {
      visitLogged = true;
      logEvent("visit");
    }
    const g = new Game(canvasRef.current, setHud);
    gameRef.current = g;
    syncHomeFrame();
    const onResize = () => {
      g.resize();
      syncHomeFrame();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      g.destroy();
    };
  }, [syncHomeFrame]);

  // Show the result modal a beat after collapse/clear so the animation reads.
  useEffect(() => {
    if (!hud) return;
    if (hud.phase === "gameover" || hud.phase === "clear") {
      setSubmitState("idle");
      setResult(null);
      logEvent("end", {
        mode: hud.mode,
        heightCm: toHeightCm(hud.peakM),
        blocks: hud.peakBlocks,
        durationMs: runStartedAt.current ? Date.now() - runStartedAt.current : undefined,
      });
      const t = setTimeout(() => {
        setShowModal(true);
        retryUntil.current = Date.now() + RETRY_DELAY_MS;
        setRetryLeft(Math.ceil(RETRY_DELAY_MS / 1000));
      }, hud.phase === "clear" ? 400 : 850);
      return () => clearTimeout(t);
    }
    setShowModal(false);
    setCard(null);
    setRetryLeft(0);
  }, [hud?.phase]);

  // 남은 시간 표시 — 0 이 되면 인터벌도 멈춘다.
  useEffect(() => {
    if (retryLeft <= 0) return;
    const t = setInterval(() => {
      const left = Math.ceil((retryUntil.current - Date.now()) / 1000);
      setRetryLeft(left > 0 ? left : 0);
    }, 150);
    return () => clearInterval(t);
  }, [retryLeft]);

  const start = useCallback((mode: GameMode) => {
    runStartedAt.current = Date.now();
    logEvent("start", { mode });
    gameRef.current?.start(mode);
  }, []);
  const reset = useCallback(() => {
    setCard(null);
    setShowModal(false);
    setResult(null);
    setSubmitState("idle");
    setRetryLeft(0);
    gameRef.current?.reset();
  }, []);
  const home = useCallback(() => {
    setCard(null);
    setShowModal(false);
    setResult(null);
    setSubmitState("idle");
    setRetryLeft(0);
    gameRef.current?.goHome();
  }, []);

  // 결과 화면에서 도달 기록을 글로벌 랭킹에 제출. 실패해도 게임엔 영향 없음.
  const submit = useCallback(async () => {
    if (!hud) return;
    const trimmed = name.trim();
    setSubmitState("sending");
    try {
      const r = await submitScore({
        playerName: trimmed || "익명",
        heightCm: toHeightCm(hud.peakM),
        blocks: hud.peakBlocks,
        mode: hud.mode,
        image: gameRef.current?.captureScoreCard(),
      });
      savePlayerName(trimmed);
      logEvent("submit", { mode: hud.mode, heightCm: toHeightCm(hud.peakM), blocks: hud.peakBlocks });
      setResult(r);
      setSubmitState("done");
    } catch {
      setSubmitState("error");
    }
  }, [hud, name]);

  // 게임 링크 + 내 점수를 공유. Web Share 우선, 없으면 클립보드 복사.
  const shareLink = useCallback(async () => {
    if (!hud) return;
    logEvent("share", { mode: hud.mode });
    const text = `높이 높이에서 ${formatHeight(hud.peakM)}m · ${hud.peakBlocks}블록 쌓았어요! 🧱 도전해보세요`;
    const url = window.location.origin;
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "높이 높이", text, url });
        return;
      } catch {
        return; // 사용자가 공유 취소
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      /* 클립보드 불가 — 무시 */
    }
  }, [hud]);

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
  // 모드별 내 최고 기록 — 홈에서 버튼마다 보여준다. hud.bestM 은 지금 고른 모드 것뿐이라 직접 읽는다.
  const bestOf = (m: GameMode) => loadRecord(m);

  // 홈에 들어올 때마다, 그리고 글꼴 로드·최고기록 배지 등장으로 블록 크기가 바뀔 때마다 다시 잰다.
  useLayoutEffect(() => {
    if (phase !== "home") return;
    syncHomeFrame();
    const ro = new ResizeObserver(syncHomeFrame);
    if (homeTopRef.current) ro.observe(homeTopRef.current);
    if (homeBottomRef.current) ro.observe(homeBottomRef.current);
    return () => ro.disconnect();
  }, [phase, syncHomeFrame]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#0b1026] text-white select-none"
      // 노치 아래에서 시작하는 상단 기준선 — HUD 와 🔊 버튼이 이 줄에 선다.
      // engine.ts hudBottom() 이 이 값 + HUD 높이 102px 를 전제로 탑 현황 패널을 배치한다.
      style={{ "--top-line": "max(1rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))" } as CSSProperties}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block touch-none" />

      {/* top scrim for legibility (노치 높이만큼 더 길게) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[calc(10rem+env(safe-area-inset-top,0px))] bg-gradient-to-b from-black/40 to-transparent" />

      {/* mute button — HUD 와 같은 줄. 좁은 화면(<560px) 게임 중엔 HUD 오른쪽 칸과 겹치므로
          HUD 바로 아래로 내린다 (engine.ts drawMinimap 이 같은 기준으로 그 아래부터 패널을 그린다) */}
      <button
        onClick={toggleMute}
        className={`pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[var(--top-line)] z-30 grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20 active:scale-95 ${
          phase === "playing" ? "max-[560px]:top-[calc(var(--top-line)+104px)]" : ""
        }`}
        aria-label="소리 켜기/끄기"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* ================= HUD (playing) ================= */}
      {phase === "playing" && hud && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[var(--top-line)]">
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
              {MODE_LABEL[hud.mode]} · 최고 {formatHeight(hud.bestM)}m · {hud.bestBlocks}블록
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
          {/* 세로 화면(가로/세로 ≤ 5/4)에선 제목은 위·버튼은 아래로 벌려 가운데를 탑 자리로 비운다.
              engine.ts isWide() 가 같은 기준으로, 재어 넘긴 빈칸(syncHomeFrame)에 탑을 세운다. */}
          <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+1rem))] text-center [@media(max-aspect-ratio:5/4)]:justify-between">
            <div ref={homeTopRef} className="animate-[rise_0.7s_ease-out]">
              <h1 className="bg-gradient-to-br from-white via-[#FFE7B0] to-[#FF9EC4] bg-clip-text text-6xl font-black leading-[0.95] tracking-tight text-transparent drop-shadow-[0_4px_20px_rgba(255,107,157,0.25)] sm:text-7xl">
                높이 높이
              </h1>
              <p className="mt-2 text-lg font-bold tracking-[0.35em] text-white/55">
                HIGHER HIGHER
              </p>
              <p className="mx-auto mt-5 max-w-sm text-base font-medium leading-relaxed text-white/75">
                무너지기 전까지, 더 높이. 블록을 하나씩 쌓아 올려
                <br className="hidden sm:block" /> 최고 높이 기록에 도전하세요.
              </p>
            </div>

            <div ref={homeBottomRef} className="mt-8 flex flex-col items-center">
              {/* 모드 선택 — 기본은 정사각형만 나와서 쉽고, 도전은 기존처럼 랜덤 블록이 나온다.
                  각 버튼 아래에 그 모드의 내 최고 기록을 보여준다(기록·순위표 모두 모드별). */}
              <div className="pointer-events-auto flex w-full max-w-xs animate-[rise_0.9s_ease-out] flex-col gap-2.5">
                <ModeButton
                  primary
                  title="기본 모드"
                  desc="정사각형만 · 쉬움"
                  best={bestOf("basic")}
                  onClick={() => start("basic")}
                />
                <ModeButton
                  title="도전 모드"
                  desc="랜덤 블록"
                  best={bestOf("random")}
                  onClick={() => start("random")}
                />
              </div>

              <button
                onClick={() => {
                  logEvent("rank");
                  setShowRanking(true);
                }}
                className="pointer-events-auto mt-3 animate-[rise_1s_ease-out] rounded-2xl bg-white/10 px-6 py-2.5 text-sm font-bold text-white/80 backdrop-blur-md transition hover:bg-white/20 active:scale-95"
              >
                🏆 글로벌 랭킹
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= RESULT MODAL =================
          좁은 화면에선 바깥·안쪽 여백을 한 단계 줄인다 — 광고(320px)가 들어갈 폭을 만들고,
          모달이 길어져 '다시 하기' 가 화면 밖으로 밀리지 않게 한다. */}
      {(phase === "gameover" || phase === "clear") && showModal && hud && (
        <div className="absolute inset-0 z-30 flex items-center justify-center px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div className="pointer-events-auto relative max-h-full w-full max-w-sm animate-[pop-in_0.35s_ease-out] overflow-y-auto rounded-3xl border border-white/10 bg-[#12173a]/95 p-5 text-center shadow-2xl sm:p-6">
            <div className="text-4xl sm:text-5xl">{phase === "clear" ? "🏆" : "💥"}</div>
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
              🏆 {MODE_LABEL[hud.mode]} 최고 {formatHeight(hud.bestM)}m · {hud.bestBlocks}블록
              {hud.peakM >= hud.bestM - 0.05 && hud.peakM > 0 && (
                <span className="ml-2 rounded-full bg-[#FFD166] px-2 py-0.5 text-[11px] font-bold text-[#3a2a00]">
                  신기록!
                </span>
              )}
            </div>

            {/* 광고 — 점수를 확인하는 동안 머무는 자리. '다시 하기' 와는 랭킹 등록 칸을 사이에 둬서
                급하게 다시 누르다 광고가 눌리는 걸 막는다. 320px 가 모달 안쪽 폭보다 넓어 좌우 여백까지 쓰고,
                그래도 안 들어가는 아주 좁은 화면(<340px)에서는 아예 띄우지 않는다. */}
            <AdFit
              unit={RESULT_AD_UNIT}
              width={320}
              height={100}
              className="-mx-5 mt-4 max-[339px]:hidden sm:-mx-6"
            />

            {/* ===== 글로벌 랭킹 등록 / 결과 ===== */}
            {hud.peakBlocks > 0 && (
              <div className="mt-4 rounded-2xl bg-white/5 p-3">
                {submitState === "done" && result ? (
                  <>
                    <div className="mb-2 text-sm font-bold text-white/80">
                      🏆 내 순위 <span className="text-[#FFD166]">#{result.rank}</span>
                      <span className="ml-1 font-medium text-white/45">
                        / 총 {result.totalCount}명
                      </span>
                    </div>
                    <LeaderboardList
                      preload={result.top}
                      highlightName={name.trim() || "익명"}
                      limit={10}
                      mode={hud.mode}
                    />
                  </>
                ) : (
                  <>
                    <div className="mb-2 text-left text-xs font-semibold text-white/55">
                      글로벌 랭킹에 기록을 남겨보세요
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={20}
                        placeholder="닉네임"
                        className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-[#FFD166]/50"
                      />
                      <button
                        onClick={submit}
                        disabled={submitState === "sending"}
                        className="shrink-0 rounded-xl bg-gradient-to-r from-[#FF6B9D] to-[#FFD166] px-4 py-2.5 text-sm font-extrabold text-[#2a0f28] transition hover:brightness-110 active:scale-95 disabled:opacity-60"
                      >
                        {submitState === "sending" ? "등록 중…" : "랭킹 등록"}
                      </button>
                    </div>
                    {submitState === "error" && (
                      <p className="mt-2 text-left text-xs font-medium text-red-300">
                        등록에 실패했어요. 잠시 후 다시 시도해주세요.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {card && (
              <img
                src={card}
                alt="결과 카드"
                className="mt-4 w-full rounded-2xl border border-white/10 shadow-lg"
              />
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              {/* 결과 창이 뜨자마자 누르면 광고가 보일 새도 없이 사라진다. 버튼은 자리에 두고
                  잠깐만 못 누르게 한다 — 늦게 나타나게 하면 그 자리를 누르려다 광고가 눌린다. */}
              <button
                onClick={reset}
                disabled={retryLeft > 0}
                className="rounded-2xl bg-gradient-to-r from-[#FF6B9D] to-[#FFD166] py-3 font-extrabold text-[#2a0f28] tabular-nums transition hover:brightness-110 active:scale-95 disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
              >
                {retryLeft > 0 ? `다시 하기 ${retryLeft}` : "다시 하기"}
              </button>
              <button
                onClick={shareLink}
                className="rounded-2xl bg-white/12 py-3 font-bold text-white/90 backdrop-blur-md transition hover:bg-white/20 active:scale-95"
              >
                {shareCopied ? "링크 복사됨! 📋" : "🔗 공유하기"}
              </button>
            </div>
            <button
              onClick={card ? shareCard : makeCard}
              className="mt-3 w-full rounded-2xl bg-white/[0.08] py-2.5 text-sm font-semibold text-white/70 backdrop-blur-md transition hover:bg-white/15 active:scale-95"
            >
              {card ? "🖼️ 결과 카드 저장 / 공유" : "🖼️ 결과 카드 만들기"}
            </button>
            <button
              onClick={home}
              className="mt-3 text-sm font-semibold text-white/45 transition hover:text-white/70"
            >
              홈으로
            </button>
          </div>
        </div>
      )}

      {/* ================= RANKING OVERLAY (home) ================= */}
      {showRanking && (
        <div className="absolute inset-0 z-40 flex items-center justify-center px-6 pt-[max(1.5rem,calc(env(safe-area-inset-top,0px)+0.5rem))] pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))]">
          <div
            className="absolute inset-0 bg-black/55"
            onClick={() => setShowRanking(false)}
          />
          <div className="pointer-events-auto relative max-h-full w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-[#12173a]/95 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black tracking-tight">🏆 글로벌 랭킹</h2>
              <button
                onClick={() => setShowRanking(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <div className="mb-3 flex gap-1 rounded-xl bg-white/5 p-1">
              {(["basic", "random"] as GameMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setRankMode(m)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                    rankMode === m ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <LeaderboardList
              limit={20}
              searchable
              mode={rankMode}
              highlightName={name.trim() || undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 홈의 모드 선택 버튼 — 제목·설명과 그 모드의 내 최고 기록. */
function ModeButton({
  title,
  desc,
  best,
  onClick,
  primary = false,
}: {
  title: string;
  desc: string;
  best: { heightM: number; blocks: number };
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl px-5 py-3 text-left transition active:scale-[0.98] ${
        primary
          ? "bg-gradient-to-r from-[#FF6B9D] to-[#FFD166] text-[#2a0f28] shadow-xl shadow-pink-500/25 hover:brightness-110"
          : "bg-white/12 text-white backdrop-blur-md hover:bg-white/20"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-extrabold">{title}</span>
        <span className={`text-[11px] font-semibold ${primary ? "text-[#2a0f28]/70" : "text-white/55"}`}>
          {desc}
        </span>
      </div>
      <div className={`mt-0.5 text-[11px] font-semibold ${primary ? "text-[#2a0f28]/65" : "text-white/45"}`}>
        {best.heightM > 0 ? `내 최고 ${formatHeight(best.heightM)}m · ${best.blocks}블록` : "아직 기록 없음"}
      </div>
    </button>
  );
}

/** 페이지 기준 레이아웃 y — transform(등장 애니메이션)을 무시한 offsetTop 누적. */
function layoutTop(el: HTMLElement): number {
  let y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
  return y;
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
