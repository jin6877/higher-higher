import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Game } from "./game/engine";
import * as SFX from "./game/audio";
import { formatHeight, loadRecord } from "./game/logic";
import { dimLabel } from "./game/dimensions";
import type { GameMode, HudState, ShapeKind } from "./game/types";
import { AdFit } from "./ads/AdFit";
import {
  Card as CardIcon,
  Check,
  Close,
  Collapse,
  Flag,
  Home as HomeIcon,
  Podium,
  Replay,
  Share,
  VolumeOff,
  VolumeOn,
  Wobble,
} from "./ui/icons";
import { logEvent } from "./analytics";
import { lang, setLang, t } from "./i18n";
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

// 모드 이름은 두 군데(HUD 줄·결과 창)에서 짧게 쓰인다 — i18n 의 modeShort 를 그대로.
const MODE_LABEL = t.modeShort as Record<GameMode, string>;

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
        playerName: trimmed || t.anonymous,
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
    const text = t.shareText(formatHeight(hud.peakM), hud.peakBlocks);
    const url = window.location.origin;
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: t.brand, text, url });
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
        await navigator.share({ files: [file], title: t.brand, text: t.shareCardText });
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
      // 노치 아래에서 시작하는 상단 기준선 — HUD 와 소리 버튼이 이 줄에 선다.
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
        className={`pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[var(--top-line)] z-30 grid h-11 w-11 place-items-center rounded-chip border-[3px] border-ink bg-cream text-ink shadow-hard transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-none ${
          phase === "playing" ? "max-[560px]:top-[calc(var(--top-line)+104px)]" : ""
        }`}
        aria-label={t.soundToggle}
      >
        {muted ? <VolumeOff size={21} /> : <VolumeOn size={21} />}
      </button>

      {/* ================= HUD (playing) ================= */}
      {phase === "playing" && hud && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[var(--top-line)]">
            <div className="mx-auto flex max-w-md items-start justify-between gap-3">
              <div className="rounded-slot border-[3px] border-ink bg-ink/90 px-4 py-2">
                <div className="text-[11px] font-bold tracking-wide text-cream/65">{t.hudHeight}</div>
                {/* 실시간으로 바뀌는 숫자는 본문 서체 + tabular-nums 로 둔다 — 디스플레이
                    서체(Black Han Sans)는 고정폭 숫자가 없어서 자릿수마다 폭이 흔들린다. */}
                <div className="text-3xl font-bold leading-none tabular-nums text-cream">
                  {formatHeight(hud.heightM)}
                  <span className="ml-0.5 text-lg text-cream/65">m</span>
                </div>
              </div>

              {/* next-block preview */}
              <div className="flex flex-col items-center rounded-slot border-[3px] border-ink bg-ink/90 px-3 py-1.5">
                <div className="text-[10px] font-bold tracking-wide text-cream/60">{t.hudNext}</div>
                <div className="mt-0.5 grid h-9 w-9 place-items-center">
                  {hud.next ? (
                    <ShapePreview kind={hud.next.kind} color={hud.next.color} />
                  ) : (
                    <div className="h-6 w-6 rounded-md bg-cream/15" />
                  )}
                </div>
                {hud.next && (
                  <div className="mt-0.5 text-[10px] font-bold leading-none tabular-nums text-cream/80">
                    {dimLabel(hud.next)}
                  </div>
                )}
              </div>

              <div className="rounded-slot border-[3px] border-ink bg-ink/90 px-4 py-2 text-right">
                <div className="text-[11px] font-bold tracking-wide text-cream/65">{t.hudBlocks}</div>
                <div className="text-3xl font-bold leading-none tabular-nums text-cream">
                  {hud.placed}
                  <span className="text-lg text-cream/55">/{hud.total}</span>
                </div>
              </div>
            </div>
            {/* progress */}
            <div className="mx-auto mt-2 h-2 max-w-md overflow-hidden rounded-chip border-2 border-ink bg-ink/80">
              <div
                className="h-full bg-gold transition-[width] duration-300"
                style={{ width: `${(hud.placed / hud.total) * 100}%` }}
              />
            </div>
            <div className="mx-auto mt-1 max-w-md text-center text-[11px] font-semibold text-cream/55">
              {t.hudBest(MODE_LABEL[hud.mode], formatHeight(hud.bestM), hud.bestBlocks)}
            </div>
          </div>

          {/* wobble warning */}
          {hud.wobble > 0.28 && (
            <div className="pointer-events-none absolute inset-x-0 top-32 z-20 flex justify-center">
              <div className="flex animate-pulse items-center gap-1.5 rounded-chip border-[3px] border-ink bg-gold px-4 py-1.5 text-sm font-bold text-ink shadow-hard">
                <Wobble size={17} />
                {t.wobbling}
              </div>
            </div>
          )}

          {/* controls */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-md items-center justify-center gap-3">
              <button
                onClick={() => gameRef.current?.rotate(-1)}
                className="pointer-events-auto grid h-14 w-14 shrink-0 place-items-center rounded-block border-[3px] border-ink bg-cream text-2xl text-ink shadow-hard transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                aria-label={t.rotateCcw}
              >
                ↺
              </button>
              <button
                onClick={() => gameRef.current?.drop()}
                className="pointer-events-auto h-14 flex-1 rounded-block border-[3px] border-ink bg-pop font-display text-xl text-ink shadow-hard-md transition active:translate-x-[5px] active:translate-y-[5px] active:shadow-none"
              >
                {t.drop}
              </button>
              <button
                onClick={() => gameRef.current?.rotate(1)}
                className="pointer-events-auto grid h-14 w-14 shrink-0 place-items-center rounded-block border-[3px] border-ink bg-cream text-2xl text-ink shadow-hard transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                aria-label={t.rotateCw}
              >
                ↻
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] font-semibold text-cream/55">
              {t.controlHint}
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
              <h1 className="text-hard-lg font-display text-[54px] leading-[0.98] text-cream sm:text-7xl">
                {t.brand}
              </h1>
              <p className="mt-3 text-xs font-bold tracking-[0.3em] text-cream/60">
                {t.brandSub}
              </p>
              <div className="mt-5 inline-block rounded-chip border-[3px] border-ink bg-gold px-4 py-1.5 shadow-hard">
                <span className="text-xs font-bold tracking-wide text-ink">
                  {t.tagline}
                </span>
              </div>
              <p className="mx-auto mt-4 max-w-sm text-sm font-semibold leading-relaxed text-cream/75">
                {t.intro}
              </p>
            </div>

            <div ref={homeBottomRef} className="mt-8 flex flex-col items-center">
              {/* 모드 선택 — 기본은 정사각형만 나와서 쉽고, 도전은 기존처럼 랜덤 블록이 나온다.
                  각 버튼 아래에 그 모드의 내 최고 기록을 보여준다(기록·순위표 모두 모드별). */}
              {/* 하드 그림자(5px)가 아래 버튼에 닿지 않게 간격을 한 단계 넓혔다. */}
              <div className="pointer-events-auto flex w-full max-w-xs animate-[rise_0.9s_ease-out] flex-col gap-4">
                {/* 색을 뒤집었다 — 전에는 제일 튀는 색(핑크)이 '기본' 에 붙어 있었는데,
                    실제로는 도전 모드가 전체 판수의 70% 가 넘는다. 강조색은 많이 하는 쪽에.
                    tone 만 바꾸면 되니 되돌리거나 mint 로 바꾸는 건 한 단어다. */}
                <ModeButton
                  tone="cream"
                  title={t.modeBasic}
                  badge={t.modeBasicBadge}
                  desc={t.modeBasicDesc}
                  best={bestOf("basic")}
                  onClick={() => start("basic")}
                />
                <ModeButton
                  tone="pop"
                  title={t.modeRandom}
                  badge={t.modeRandomBadge}
                  desc={t.modeRandomDesc}
                  best={bestOf("random")}
                  onClick={() => start("random")}
                />
              </div>

              <button
                onClick={() => {
                  logEvent("rank");
                  setShowRanking(true);
                }}
                className="pointer-events-auto mt-5 flex animate-[rise_1s_ease-out] items-center gap-2 rounded-chip border-[3px] border-cream bg-ink/60 px-6 py-2.5 text-sm font-bold text-cream transition active:scale-95"
              >
                <Podium size={18} />
                {t.leaderboard}
              </button>

              {/* 언어는 브라우저 설정으로 자동으로 고르지만, 그게 원하는 언어가 아닐 수
                  있다(회사 PC 가 영어로 맞춰져 있다거나). 되돌릴 길은 열어 둔다. */}
              <button
                onClick={() => setLang(lang === "ko" ? "en" : "ko")}
                className="pointer-events-auto mt-3 animate-[rise_1.1s_ease-out] px-3 py-2 text-xs font-bold text-cream/60 underline-offset-4 transition hover:text-cream hover:underline"
              >
                {t.switchTo}
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
          <div className="pointer-events-none absolute inset-0 bg-night/70" />
          <div className="pointer-events-auto relative max-h-full w-full max-w-sm animate-[pop-in_0.35s_ease-out] overflow-y-auto rounded-panel border-[3px] border-ink bg-cream p-4 text-center text-ink shadow-hard-lg sm:p-5">
            <div className="flex justify-center text-pop">
              {phase === "clear" ? <Flag size={44} /> : <Collapse size={44} />}
            </div>
            <h2 className="mt-2 font-display text-[28px] leading-tight">
              {phase === "clear" ? t.clearTitle : t.fellTitle}
            </h2>
            <p className="mt-1 text-sm font-semibold text-ink/70">
              {phase === "clear" ? t.clearSub : t.fellSub}
            </p>

            <div className="mt-4 flex gap-2.5">
              <Stat tone="gold" label={t.statHeight} value={`${formatHeight(hud.peakM)}m`} />
              <Stat tone="mint" label={t.statBlocks} value={`${hud.peakBlocks}/${hud.total}`} />
            </div>
            <div className="mt-2.5 flex items-center gap-2 rounded-block bg-ink px-3 py-2.5 text-left">
              <Podium size={17} className="shrink-0 text-gold" />
              <span className="flex-1 text-[12px] font-bold tabular-nums text-cream">
                {t.bestLine(MODE_LABEL[hud.mode], formatHeight(hud.bestM), hud.bestBlocks)}
              </span>
              {hud.peakM >= hud.bestM - 0.05 && hud.peakM > 0 && (
                <span className="shrink-0 rounded-chip bg-pop px-2 py-0.5 text-[10px] font-bold text-ink">
                  {t.newRecord}
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
              // 모달 안쪽 여백(p-4 / sm:p-5)을 상쇄해 광고가 판 끝까지 쓰게 한다.
              className="-mx-4 mt-4 max-[339px]:hidden sm:-mx-5"
            />

            {/* ===== 글로벌 랭킹 등록 / 결과 ===== */}
            {hud.peakBlocks > 0 && (
              <div className="mt-4 rounded-block border-[3px] border-ink bg-cream-dim p-3">
                {submitState === "done" && result ? (
                  <>
                    <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
                      <Podium size={16} />{t.myRank}{" "}
                      <span className="font-display text-lg">#{result.rank}</span>
                      <span className="font-semibold text-ink/70">
                        {t.ofTotal(result.totalCount)}
                      </span>
                    </div>
                    <LeaderboardList
                      preload={result.top}
                      highlightName={name.trim() || t.anonymous}
                      limit={10}
                      mode={hud.mode}
                    />
                  </>
                ) : (
                  <>
                    <div className="mb-2 text-left text-xs font-bold text-ink/70">
                      {t.submitPrompt}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={20}
                        placeholder={t.nickname}
                        aria-label={t.nickname}
                        className="min-w-0 flex-1 rounded-slot border-[3px] border-ink bg-white px-3 py-2 text-sm font-semibold text-ink outline-none placeholder:text-ink/55 focus:border-pop"
                      />
                      <button
                        onClick={submit}
                        disabled={submitState === "sending"}
                        className="shrink-0 rounded-slot border-[3px] border-ink bg-ink px-4 py-2 text-sm font-bold text-cream transition active:scale-95 disabled:opacity-60"
                      >
                        {submitState === "sending" ? t.submitting : t.submit}
                      </button>
                    </div>
                    {submitState === "error" && (
                      <p className="mt-2 text-left text-xs font-bold text-pop">
                        {t.submitFailed}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {card && (
              <img
                src={card}
                alt={t.resultCard}
                className="mt-4 w-full rounded-block border-[3px] border-ink"
              />
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              {/* 결과 창이 뜨자마자 누르면 광고가 보일 새도 없이 사라진다. 버튼은 자리에 두고
                  잠깐만 못 누르게 한다 — 늦게 나타나게 하면 그 자리를 누르려다 광고가 눌린다. */}
              <button
                onClick={reset}
                disabled={retryLeft > 0}
                className="flex items-center justify-center gap-2 rounded-block border-[3px] border-ink bg-pop py-3 font-display text-lg text-ink tabular-nums shadow-hard transition enabled:active:translate-x-[3px] enabled:active:translate-y-[3px] enabled:active:shadow-none disabled:cursor-default disabled:opacity-50"
              >
                <Replay size={19} />
                {retryLeft > 0 ? `${t.playAgain} ${retryLeft}` : t.playAgain}
              </button>
              <button
                onClick={shareLink}
                className="flex items-center justify-center gap-2 rounded-block border-[3px] border-ink bg-cream py-3 text-[15px] font-bold text-ink shadow-hard transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
              >
                {shareCopied ? <Check size={18} /> : <Share size={18} />}
                {shareCopied ? t.copied : t.share}
              </button>
            </div>
            <button
              onClick={card ? shareCard : makeCard}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-block border-[3px] border-ink py-2.5 text-sm font-bold text-ink transition active:scale-[0.98]"
            >
              <CardIcon size={18} />
              {card ? t.saveCard : t.makeCard}
            </button>
            <button
              onClick={home}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-ink/70 transition hover:text-ink"
            >
              <HomeIcon size={16} />
              {t.home}
            </button>
          </div>
        </div>
      )}

      {/* ================= RANKING OVERLAY (home) ================= */}
      {showRanking && (
        <div className="absolute inset-0 z-40 flex items-center justify-center px-6 pt-[max(1.5rem,calc(env(safe-area-inset-top,0px)+0.5rem))] pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))]">
          <div
            className="absolute inset-0 bg-night/70"
            onClick={() => setShowRanking(false)}
          />
          <div className="pointer-events-auto relative max-h-full w-full max-w-sm overflow-y-auto rounded-panel border-[3px] border-ink bg-cream p-5 text-ink shadow-hard-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-xl">
                <Podium size={20} />
                {t.leaderboard}
              </h2>
              <button
                onClick={() => setShowRanking(false)}
                className="grid h-9 w-9 place-items-center rounded-chip border-[3px] border-ink bg-cream-dim text-ink transition active:scale-95"
                aria-label={t.close}
              >
                <Close size={16} />
              </button>
            </div>
            <div className="mb-3 flex gap-1.5 rounded-slot border-[3px] border-ink bg-cream-dim p-1">
              {(["basic", "random"] as GameMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setRankMode(m)}
                  className={`flex-1 rounded-[7px] py-1.5 text-xs font-bold transition ${
                    rankMode === m ? "bg-ink text-cream" : "text-ink/70 hover:text-ink"
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
  badge,
  desc,
  best,
  onClick,
  tone,
}: {
  title: string;
  /** 오른쪽 작은 칩 — 난이도/성격 한 단어. */
  badge: string;
  desc: string;
  best: { heightM: number; blocks: number };
  onClick: () => void;
  tone: "cream" | "pop";
}) {
  const pop = tone === "pop";
  return (
    <button
      onClick={onClick}
      // 눌림은 scale 이 아니라 '그림자만큼 밀려 들어가는' 방식 — 하드 그림자 문법에선
      // 이쪽이 실제로 눌리는 물건처럼 읽힌다.
      className={`w-full rounded-block border-[3px] border-ink px-4 py-3.5 text-left text-ink shadow-hard-md transition active:translate-x-[5px] active:translate-y-[5px] active:shadow-none ${
        pop ? "bg-pop" : "bg-cream"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-xl">{title}</span>
        <span
          className={`shrink-0 rounded-chip border-2 border-ink px-2 py-0.5 text-[11px] font-bold ${
            pop ? "bg-cream" : "bg-mint"
          }`}
        >
          {badge}
        </span>
      </div>
      <div className="mt-1.5 text-[11px] font-semibold tabular-nums text-ink/70">
        {desc} ·{" "}
        {best.heightM > 0 ? t.myBest(formatHeight(best.heightM), best.blocks) : t.noRecord}
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

/** 결과 창의 지표 한 칸. 값은 판이 끝난 뒤 고정이라 디스플레이 서체를 써도 흔들릴 일이 없다. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "gold" | "mint";
}) {
  return (
    <div
      className={`flex-1 rounded-block border-[3px] border-ink px-3 py-2.5 text-left ${
        tone === "gold" ? "bg-gold" : "bg-mint"
      }`}
    >
      <div className="text-[11px] font-bold text-ink/70">{label}</div>
      <div className="mt-0.5 font-display text-[26px] leading-none text-ink">{value}</div>
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
