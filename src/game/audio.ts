// Tiny Web Audio SFX. Lazily created on first user gesture; silent-safe.

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(v: boolean) {
  // 멱등 — StrictMode 개발 모드에선 App 의 상태 updater 가 두 번 돌아 같은 값으로 두 번 불린다.
  if (v === muted) return;
  muted = v;
  // 효과음은 짧아서 플래그만으로 충분하지만, 계속 도는 BGM 은 직접 멈추고 다시 틀어야 한다.
  if (v) {
    bgmGen++; // 로딩 중이던 시작도 취소
    stopBgmNode(0.05);
  } else if (bgmWanted) {
    startBgm(); // 음소거 해제 — 도입부부터 다시
  }
}

export function isMuted() {
  return muted;
}

/** unlock audio on first gesture */
export function primeAudio() {
  ac();
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.14, delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function sfxDrop() {
  tone(220, 0.12, "sine", 0.1);
}

export function sfxLand() {
  tone(320, 0.09, "triangle", 0.12);
  tone(160, 0.14, "sine", 0.08, 0.01);
}

export function sfxPlace() {
  // pleasant little "ding" when a block settles well
  tone(660, 0.1, "sine", 0.1);
  tone(990, 0.12, "sine", 0.07, 0.04);
}

export function sfxWarn() {
  tone(140, 0.16, "sawtooth", 0.06);
}

export function sfxCollapse() {
  const a = ac();
  if (!a) return;
  // descending rumble
  for (let i = 0; i < 5; i++) {
    tone(200 - i * 28, 0.18, "sawtooth", 0.09, i * 0.05);
  }
}

export function sfxClear() {
  const notes = [523, 659, 784, 1046];
  notes.forEach((n, i) => tone(n, 0.22, "triangle", 0.12, i * 0.11));
}

// ---------- BGM ----------
// public/bgm.m4a = 도입부 3박 + 반복 구간 10박 (♩=110). 도입부는 한 번만 울리고
// 반복 구간만 loopStart/loopEnd 로 이음새 없이 돈다. 두 경계 모두 음 사이 50ms 무음 틈
// 안에 있어서, 디코더가 앞쪽 인코더 지연(AAC ~23ms)을 안 잘라도 튀는 소리가 나지 않는다.
const BGM_URL = `${import.meta.env.BASE_URL}bgm.m4a`;
const BGM_BEAT = 60 / 110;
const BGM_LOOP_START = 3 * BGM_BEAT;
const BGM_LOOP_END = 13 * BGM_BEAT;
const BGM_GAIN = 0.22; // 효과음(0.06~0.14) 아래로 깔리게

let bgmBytes: Promise<ArrayBuffer> | null = null;
let bgmBuffer: Promise<AudioBuffer> | null = null;
let bgm: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let bgmWanted = false; // 게임 중이라 울려야 하는 상태 — 음소거 중에도 유지해 해제 시 재개
let bgmGen = 0; // 로딩 중에 stop/재시작이 끼어들면 늦게 도착한 시작을 버린다

/** 파일만 미리 받아 둔다. 디코드는 AudioContext 가 필요해 재생 시점에 한다. */
export function preloadBgm() {
  if (bgmBytes || typeof window === "undefined") return;
  bgmBytes = fetch(BGM_URL).then((r) => {
    if (!r.ok) throw new Error(`bgm ${r.status}`);
    return r.arrayBuffer();
  });
  bgmBytes.catch(() => {});
}

function loadBgm(a: AudioContext): Promise<AudioBuffer> {
  if (!bgmBuffer) {
    preloadBgm();
    bgmBuffer = bgmBytes!.then((b) => a.decodeAudioData(b));
    // 실패하면 다음 게임 시작 때 처음부터 다시 받는다 (decodeAudioData 가 버퍼를 소모하므로 바이트도 버림)
    bgmBuffer.catch(() => {
      bgmBuffer = null;
      bgmBytes = null;
    });
  }
  return bgmBuffer;
}

function stopBgmNode(fade = 0.25) {
  if (!bgm) return;
  const { src, gain } = bgm;
  bgm = null;
  try {
    const t = gain.context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.02);
  } catch {
    /* 이미 멈춤 */
  }
}

/** 게임 시작 시 — 도입부부터 틀고 반복 구간을 계속 돈다. 사용자 제스처 안에서 불러야 한다. */
export function startBgm() {
  bgmWanted = true;
  stopBgmNode(0.05);
  const gen = ++bgmGen;
  const a = ac();
  if (!a) return; // 음소거 중 — 해제되면 setMuted 가 다시 부른다
  loadBgm(a)
    .then((buf) => {
      if (gen !== bgmGen || !bgmWanted || muted) return;
      const src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = BGM_LOOP_START;
      src.loopEnd = Math.min(BGM_LOOP_END, buf.duration);
      const gain = a.createGain();
      gain.gain.value = BGM_GAIN;
      src.connect(gain);
      gain.connect(a.destination);
      src.start();
      bgm = { src, gain };
    })
    .catch(() => {
      /* 디코드 불가(AAC 미지원 브라우저 등) — BGM 없이 진행, 게임엔 영향 없음 */
    });
}

/** 게임 종료·홈 이동 시. */
export function stopBgm() {
  bgmWanted = false;
  bgmGen++;
  stopBgmNode();
}

// 탭이 가려지면 멈추고 돌아오면 이어서 — 짧은 효과음만 있을 땐 필요 없었지만
// 반복 BGM 은 백그라운드 탭에서 계속 울리게 된다.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (!muted) ctx.resume().catch(() => {});
  });
}
