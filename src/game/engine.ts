// Higher Higher — physics engine + custom canvas renderer + camera + input.
// Matter.js runs the rigid-body simulation on a fixed timestep; everything
// visual is drawn by hand so we control the sky, camera and block styling.

import Matter from "matter-js";
import {
  AIM_RANGE,
  FIXED_DT,
  PIXELS_PER_METER,
  PLATFORM_HEIGHT,
  PLATFORM_TOP_Y,
  PLATFORM_WIDTH,
  SETTLE_ANGULAR,
  SETTLE_FRAMES,
  SETTLE_MAX_WAIT_MS,
  SETTLE_SPEED,
  SWING_CENTER_X,
  SWING_RANGE,
  TOTAL_BLOCKS,
} from "./constants";
import { swingOffset, swingPeriodMs } from "./swing";
import { dimLabel } from "./dimensions";
import { darken, lighten, withAlpha } from "./color";
import {
  altitude01 as altitudeNorm,
  BLOCK_COLORS,
  rgb,
  sampleSky,
} from "./palette";
import {
  detectCollapse,
  heightMeters,
  isCleared,
  loadRecord,
  saveRecord,
  trackPeak,
  type Record as HRecord,
} from "./logic";
import { mulberry32, randRange, type Rng } from "./rng";
import { makeBlockSpec } from "./shapes";
import * as SFX from "./audio";
import type { BlockSpec, HudState, Phase } from "./types";

const { Engine, Bodies, Body, Composite, Events } = Matter;

const HOVER_GAP = 12; // small air gap between drop point and tower top (soft landing)
const FOCUS_FRAC = 0.34; // where the action sits vertically on screen
const TARGET_VIEW = 560; // world units visible vertically (drives base zoom)

interface Block {
  body: Matter.Body;
  spec: BlockSpec;
  settled: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  spin: number;
  rot: number;
  confetti: boolean;
}

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
  phase: number;
}

const bodyOpts: Matter.IChamferableBodyDefinition = {
  friction: 0.95, // grippy contacts so aligned blocks don't slide/shimmy
  frictionStatic: 2.4, // strong static grip once at rest
  restitution: 0, // no bounce — blocks land with a dead "thunk", never spring
  density: 0.002,
  frictionAir: 0.02,
  slop: 0.02,
  sleepThreshold: 24, // ~0.4s of calm -> body sleeps (kills residual micro-jitter)
};

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onState: (h: HudState) => void;

  private engine: Matter.Engine;
  private world: Matter.World;
  private platform!: Matter.Body;

  private blocks: Block[] = [];
  private pending: BlockSpec | null = null; // current block being aimed (swinging)
  private nextSpec: BlockSpec | null = null; // the one after — shown in the HUD preview
  private active: Block | null = null;
  private activeLanded = false;
  private calm = 0;
  private dropAt = 0;

  private placedCount = 0;
  private peakHeightM = 0; // highest tower height reached this run (survives collapse)
  private peakBlocks = 0; // most blocks standing this run (survives collapse)
  private idCounter = 1;
  private lastColor: string | undefined;
  private rng: Rng;

  private phase: Phase = "home";
  private cleared = false;
  // Snapshot of the score card taken at the last successful placement, so a
  // collapsed/tumbling tower is never what gets shared or submitted to ranking.
  private lastCard: string | null = null;

  private aimX = 0;
  private aimAngle = 0;
  private awaiting = false;
  private swingStart = 0; // this.time when the current block began its sweep

  private cam = { y: -140, zoom: 1, shakeX: 0, shakeY: 0, shakeMag: 0, offsetX: 0 };
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private wobble = 0;
  private warnCooldown = 0;
  private miniPanelW = 0; // smoothed minimap panel width (adapts to the tower's real proportions)
  // 노치·홈바 안전 영역(px). 캔버스는 CSS env() 를 못 읽어서 resize 때 프로브 요소로 잰다.
  private safe = { top: 0, right: 0, bottom: 0 };
  // 세로 화면 홈에서 제목(위)과 버튼(아래) 사이 빈칸 — App 이 실제 DOM 위치를 재서 넘겨준다.
  private homeFrame: { top: number; bottom: number } | null = null;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private time = 0;
  private lastTs = 0;
  private acc = 0;
  private raf = 0;
  private record: HRecord;
  private lastEmit = 0;
  private lastEmitKey = "";

  private cleanups: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, onState: (h: HudState) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.onState = onState;
    this.record = loadRecord();
    SFX.preloadBgm(); // 첫 게임 시작 때 받느라 도입부가 늦게 나오지 않도록 미리 받아 둔다

    const seedParam = new URLSearchParams(window.location.search).get("seed");
    const seed = seedParam ? Number(seedParam) >>> 0 : (Math.random() * 1e9) >>> 0;
    this.rng = mulberry32(seed);

    this.engine = Engine.create();
    this.engine.enableSleeping = true; // let settled stacks fall asleep -> zero drift
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.001;
    this.engine.positionIterations = 24; // stiffer stacks (less penetration wobble)
    this.engine.velocityIterations = 18;
    this.engine.constraintIterations = 6;
    this.world = this.engine.world;

    this.makePlatform();
    this.makeStars();

    Events.on(this.engine, "collisionStart", (e) => this.onCollision(e));

    this.resize();
    this.buildDemo();
    this.bindInput();
    this.exposeTestHooks();

    this.lastTs = performance.now();
    this.loop(this.lastTs);
  }

  // ---------- setup ----------

  private makePlatform() {
    this.platform = Bodies.rectangle(
      0,
      PLATFORM_TOP_Y + PLATFORM_HEIGHT / 2,
      PLATFORM_WIDTH,
      PLATFORM_HEIGHT,
      { isStatic: true, friction: 1, frictionStatic: 1.4, restitution: 0 },
    );
    Composite.add(this.world, this.platform);
  }

  private makeStars() {
    const rng = mulberry32(9137);
    const n = 140;
    this.stars = [];
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: rng(),
        y: rng(),
        r: randRange(rng, 0.6, 1.8),
        tw: randRange(rng, 0.8, 2.4),
        phase: rng() * Math.PI * 2,
      });
    }
  }

  private createBody(spec: BlockSpec, x: number, y: number, angle: number): Matter.Body {
    let body: Matter.Body;
    if (spec.radius != null) {
      body = Bodies.circle(x, y, spec.radius, { ...bodyOpts });
    } else if (spec.parts) {
      const parts = spec.parts.map((p) =>
        Bodies.rectangle(x + p.x, y + p.y, p.w, p.h, { ...bodyOpts }),
      );
      body = Body.create({ ...bodyOpts, parts });
      Body.setPosition(body, { x, y });
    } else if (spec.vertices) {
      body = Bodies.fromVertices(x, y, [spec.vertices], { ...bodyOpts }, true);
    } else {
      body = Bodies.rectangle(x, y, spec.w, spec.h, { ...bodyOpts });
    }
    Body.setAngle(body, angle);
    return body;
  }

  /** create a body and align its footprint: centre-x -> aimX, bottom -> worldBottom */
  private spawnBody(spec: BlockSpec, aimX: number, worldBottom: number, angle: number): Matter.Body {
    const body = this.createBody(spec, 0, 0, angle);
    const bcx = (body.bounds.min.x + body.bounds.max.x) / 2;
    Body.translate(body, { x: aimX - bcx, y: worldBottom - body.bounds.max.y });
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
    return body;
  }

  private buildDemo() {
    this.clearBlocks();
    const drng = mulberry32(20240811);
    let top = PLATFORM_TOP_Y;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const idx = Math.min(i, 6); // keep pool tidy (no rolly shapes) for the hero
      const spec = makeBlockSpec(this.idCounter++, idx, drng, this.lastColor);
      this.lastColor = spec.color;
      const cx = Math.sin(i * 1.25) * 6 + randRange(drng, -2, 2);
      const body = this.spawnBody(spec, cx, top - 1, randRange(drng, -0.03, 0.03));
      Composite.add(this.world, body);
      this.blocks.push({ body, spec, settled: true });
      top = body.bounds.min.y;
    }
    for (let s = 0; s < 170; s++) Engine.update(this.engine, FIXED_DT);
    this.phase = "home";
    this.lastColor = undefined;
    this.idCounter = 1;
    this.snapCamera();
    this.emit(true);
  }

  private clearBlocks() {
    for (const b of this.blocks) Composite.remove(this.world, b.body);
    this.blocks = [];
    this.active = null;
    this.pending = null;
    this.nextSpec = null;
    this.particles = [];
  }

  // ---------- game flow ----------

  start() {
    SFX.primeAudio();
    SFX.startBgm(); // 다시 하기(reset)도 여기로 오므로 매 판 도입부부터
    this.clearBlocks();
    this.placedCount = 0;
    this.peakHeightM = 0;
    this.peakBlocks = 0;
    this.cleared = false;
    this.lastCard = null;
    this.wobble = 0;
    this.lastColor = undefined;
    this.phase = "playing";
    this.aimX = 0;
    this.aimAngle = 0;
    this.initQueue();
    this.snapCamera();
    this.emit(true);
  }

  reset() {
    this.record = loadRecord();
    this.start();
  }

  goHome() {
    SFX.stopBgm();
    this.record = loadRecord();
    this.buildDemo();
  }

  /** create a fresh spec for a given placement index, tracking colour variety */
  private makeSpec(index: number): BlockSpec {
    const spec = makeBlockSpec(this.idCounter++, index, this.rng, this.lastColor);
    this.lastColor = spec.color;
    return spec;
  }

  /** seed the current + next blocks at the start of a run */
  private initQueue() {
    this.pending = this.makeSpec(this.placedCount); // index 0 -> current
    this.nextSpec = this.makeSpec(this.placedCount + 1); // index 1 -> preview
    this.beginSwing();
  }

  /** promote the previewed block to current and roll a new preview */
  private advanceQueue() {
    // placedCount has already been incremented by confirmPlace
    this.pending = this.nextSpec ?? this.makeSpec(this.placedCount);
    this.nextSpec = this.makeSpec(this.placedCount + 1);
    this.beginSwing();
  }

  /** (re)start the horizontal sweep from centre for the current block */
  private beginSwing() {
    this.aimX = 0;
    this.aimAngle = 0;
    this.swingStart = this.time;
    this.awaiting = true;
  }

  /** auto-oscillate the current block; called every frame while awaiting a drop */
  private updateSwing() {
    if (this.phase !== "playing" || !this.awaiting || !this.pending) return;
    const period = swingPeriodMs(this.placedCount);
    // Sweep is anchored to the FIXED field centre (pedestal centre), never the
    // tower top — so a leaning stack can't drag the sweep to its side. The block
    // covers the whole play field and can be dropped anywhere across the base.
    const center = SWING_CENTER_X;
    const offset = swingOffset(this.time - this.swingStart, SWING_RANGE, period);
    this.setAim(center + offset);
  }

  drop() {
    if (this.phase !== "playing" || !this.awaiting || !this.pending) return;
    const spec = this.pending;
    const worldBottom = this.settledTopY() - HOVER_GAP;
    const body = this.spawnBody(spec, this.aimX, worldBottom, this.aimAngle);
    Composite.add(this.world, body);
    const block: Block = { body, spec, settled: false };
    this.blocks.push(block);
    this.active = block;
    this.activeLanded = false;
    this.calm = 0;
    this.dropAt = this.time;
    this.awaiting = false;
    this.pending = null;
    SFX.sfxDrop();
    this.emit(true);
  }

  setAim(worldX: number) {
    this.aimX = Math.max(-AIM_RANGE, Math.min(AIM_RANGE, worldX));
  }

  rotate(dir: number) {
    if (this.phase !== "playing" || !this.awaiting) return;
    this.aimAngle += dir * (Math.PI / 12);
  }

  private confirmPlace() {
    if (!this.active) return;
    this.active.settled = true;
    const b = this.active;
    this.active = null;
    this.placedCount++;
    this.updatePeak(); // lock in this height before a possible clear/collapse
    // Snapshot the intact tower now; overwrites the previous shot. If the tower
    // topples next, this last good snapshot is what we share/submit.
    this.lastCard = this.renderScoreCard();
    SFX.sfxPlace();
    this.burst(b.body.position.x, b.body.bounds.min.y, b.spec.color, 10, false);
    if (isCleared(this.placedCount, TOTAL_BLOCKS)) {
      this.clearGame();
    } else {
      this.advanceQueue();
    }
    this.emit(true);
  }

  private clearGame() {
    this.phase = "clear";
    this.cleared = true;
    this.updatePeak();
    // finalize on the PEAK reached, never a value that dipped during the run
    this.record = saveRecord(this.peakHeightM, this.peakBlocks);
    SFX.stopBgm(); // 완주 효과음이 묻히지 않게
    SFX.sfxClear();
    this.confetti();
    this.emit(true);
  }

  private triggerGameOver() {
    if (this.phase !== "playing") return;
    this.phase = "gameover";
    this.active = null;
    this.awaiting = false;
    // score the run by the peak height it reached BEFORE toppling — the tower
    // is already tumbling (blocks falling away), so the live height is lower now.
    this.record = saveRecord(this.peakHeightM, this.peakBlocks);
    this.cam.shakeMag = 14;
    SFX.stopBgm(); // 무너지는 효과음이 묻히지 않게
    SFX.sfxCollapse();
    this.emit(true);
  }

  /** Fold the current tower height/blocks into the run's peak (monotonic). */
  private updatePeak() {
    this.peakHeightM = trackPeak(this.peakHeightM, this.currentHeightM());
    if (this.placedCount > this.peakBlocks) this.peakBlocks = this.placedCount;
  }

  // ---------- physics step ----------

  private step(dt: number) {
    Engine.update(this.engine, dt);
    this.updateParticles(dt);

    if (this.phase === "playing") {
      // collapse detection over every placed block
      if (detectCollapse(this.blocks.map((b) => ({ centerY: b.body.position.y, topY: b.body.bounds.min.y, settled: b.settled })))) {
        this.triggerGameOver();
        return;
      }
      // settle detection for the active block
      if (this.active) {
        const spd = this.active.body.speed;
        const asp = this.active.body.angularSpeed;
        if (spd < SETTLE_SPEED && asp < SETTLE_ANGULAR) this.calm++;
        else this.calm = 0;
        const waited = this.time - this.dropAt;
        if (this.calm >= SETTLE_FRAMES || this.active.body.isSleeping || waited > SETTLE_MAX_WAIT_MS) {
          this.confirmPlace();
        }
      }
      this.updateWobble();
      this.updatePeak(); // keep the peak fresh even between placements
    }
  }

  private updateWobble() {
    let maxSpeed = 0;
    for (const b of this.blocks) {
      if (b.settled) maxSpeed = Math.max(maxSpeed, b.body.speed);
    }
    const target = Math.max(0, Math.min(1, (maxSpeed - 0.15) / 2.2));
    this.wobble += (target - this.wobble) * 0.2;
    if (this.wobble > 0.28 && this.warnCooldown <= 0) {
      SFX.sfxWarn();
      this.warnCooldown = 500;
    }
  }

  // ---------- helpers ----------

  private settledTopY(): number {
    let top = PLATFORM_TOP_Y;
    for (const b of this.blocks) {
      if (b.settled && b.body.bounds.min.y < top) top = b.body.bounds.min.y;
    }
    return top;
  }

  private currentHeightM(): number {
    return heightMeters(this.settledTopY());
  }

  /** the highest settled block (the surface the next block lands on) */
  private topSettledBlock(): Block | null {
    let topY = Infinity;
    let top: Block | null = null;
    for (const b of this.blocks) {
      if (b.settled && b.body.bounds.min.y < topY) {
        topY = b.body.bounds.min.y;
        top = b;
      }
    }
    return top;
  }

  /** centre-x of the highest settled block (the surface the next block lands on) */
  private topBlockCenterX(): number {
    return this.topSettledBlock()?.body.position.x ?? 0;
  }

  /** centre-y of the highest settled block (for drift measurement in tests) */
  private topBlockTopY(): number {
    return this.topSettledBlock()?.body.position.y ?? 0;
  }

  /** angle (rad) of the highest settled block (for wobble measurement in tests) */
  private topBlockAngle(): number {
    return this.topSettledBlock()?.body.angle ?? 0;
  }

  private focusTopY(): number {
    let focus = this.settledTopY();
    if (this.awaiting && this.pending) {
      focus = Math.min(focus, focus - HOVER_GAP - this.pending.h);
    } else if (this.active) {
      focus = Math.min(focus, this.active.body.bounds.min.y);
    }
    return focus;
  }

  // ---------- camera ----------

  private computeCamTarget() {
    const alt = this.currentHeightM();
    const baseZoom = Math.max(0.62, Math.min(1.5, this.H / TARGET_VIEW));

    if (this.phase === "home" && !this.isWide() && this.homeFrame) {
      // 세로 화면 홈: 데모 탑 전체(꼭대기~받침대)를 제목과 버튼 사이 빈칸에 세운다.
      // 가운데 서면 가운데 정렬된 설명 글과 그대로 겹친다. 받침대 바닥을 빈칸 아래에 붙여
      // 탑이 땅에서 올라오게 하고, 넘치면 빈칸에 맞게(그리고 폭에 맞게) 줄인다.
      const top = this.settledTopY();
      const base = PLATFORM_TOP_Y + PLATFORM_HEIGHT;
      const bandTop = this.homeFrame.top + 20;
      const bandBot = this.homeFrame.bottom - 12;
      const zoom = Math.max(
        0.3,
        Math.min(baseZoom, (bandBot - bandTop) / (base - top), (this.W - 48) / PLATFORM_WIDTH),
      );
      return { camY: base - (bandBot - this.H / 2) / zoom, zoom };
    }

    let zoom = Math.max(0.5, Math.min(1.5, baseZoom * (1 - 0.1 * altitudeNorm(alt))));
    if (this.phase !== "home" && this.miniTiny()) {
      // 좁은 화면: 오른쪽 탑 현황 패널 자리만큼 비워, 받침대가 패널 밑으로 들어가지 않게 살짝 줄인다.
      const reserve = this.miniTinyPanelW() + this.miniMargin() + 4;
      zoom = Math.min(zoom, (this.W - 2 * reserve) / PLATFORM_WIDTH);
    }
    const focus = this.focusTopY();
    const camY = focus - (FOCUS_FRAC * this.H - this.H / 2) / zoom;
    return { camY, zoom };
  }

  /** 가로로 넓은 화면 — 홈에서 탑을 오른쪽으로 비키고 글은 가운데. App.tsx 의 (max-aspect-ratio: 5/4) 와 짝. */
  private isWide(): boolean {
    return this.W / this.H > 1.25;
  }

  private targetOffsetX(): number {
    return this.phase === "home" && this.isWide() ? this.W * 0.2 : 0;
  }

  /** 세로 화면 홈에서 탑을 세울 빈칸(화면 y, px). */
  setHomeFrame(top: number, bottom: number) {
    this.homeFrame = { top, bottom };
    if (this.phase === "home") this.snapCamera();
  }

  // 아래 두 값은 App.tsx 의 HUD·조작 버튼 배치와 짝이다(상단 패딩 max(16, 노치+8) + HUD 102px,
  // 하단 패딩 max(16, 홈바) + 버튼·안내문 102px). 한쪽을 바꾸면 같이 바꿔야 패널이 가려지지 않는다.
  private hudBottom(): number {
    return Math.max(16, this.safe.top + 8) + 102;
  }
  private controlsTop(): number {
    return this.H - Math.max(16, this.safe.bottom) - (this.phase === "playing" ? 102 : 16);
  }

  private snapCamera() {
    const t = this.computeCamTarget();
    this.cam.y = t.camY;
    this.cam.zoom = t.zoom;
    this.cam.offsetX = this.targetOffsetX();
  }

  private updateCamera(dt: number) {
    const t = this.computeCamTarget();
    this.cam.y += (t.camY - this.cam.y) * Math.min(1, 0.12 * (dt / FIXED_DT));
    this.cam.zoom += (t.zoom - this.cam.zoom) * Math.min(1, 0.08 * (dt / FIXED_DT));
    this.cam.offsetX += (this.targetOffsetX() - this.cam.offsetX) * Math.min(1, 0.12 * (dt / FIXED_DT));
    if (this.cam.shakeMag > 0.2) {
      this.cam.shakeX = (Math.random() - 0.5) * this.cam.shakeMag;
      this.cam.shakeY = (Math.random() - 0.5) * this.cam.shakeMag;
      this.cam.shakeMag *= 0.9;
    } else {
      this.cam.shakeX = 0;
      this.cam.shakeY = 0;
      this.cam.shakeMag = 0;
    }
  }

  private sx(wx: number) {
    return this.W / 2 + wx * this.cam.zoom + this.cam.shakeX + this.cam.offsetX;
  }
  private sy(wy: number) {
    return this.H / 2 + (wy - this.cam.y) * this.cam.zoom + this.cam.shakeY;
  }

  // ---------- particles ----------

  private burst(x: number, y: number, color: string, count: number, big: boolean) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 1.8;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.6,
        life: 520 + Math.random() * 320,
        max: 840,
        size: (big ? 4 : 2) + Math.random() * 3,
        color,
        spin: (Math.random() - 0.5) * 0.4,
        rot: Math.random() * Math.PI,
        confetti: big,
      });
    }
  }

  private confetti() {
    const top = this.settledTopY();
    for (let i = 0; i < 120; i++) {
      const color = BLOCK_COLORS[i % BLOCK_COLORS.length];
      this.particles.push({
        x: (Math.random() - 0.5) * 260,
        y: top - Math.random() * 220,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 2 - 0.5,
        life: 1600 + Math.random() * 1200,
        max: 2800,
        size: 4 + Math.random() * 5,
        color,
        spin: (Math.random() - 0.5) * 0.5,
        rot: Math.random() * Math.PI,
        confetti: true,
      });
    }
  }

  private updateParticles(dt: number) {
    const k = dt / 16;
    if (this.warnCooldown > 0) this.warnCooldown -= dt;
    for (const p of this.particles) {
      p.vy += 0.05 * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.spin * k;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private onCollision(e: Matter.IEventCollision<Matter.Engine>) {
    if (!this.active || this.activeLanded) return;
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ap = a.parent ?? a;
      const bp = b.parent ?? b;
      if (ap === this.active.body || bp === this.active.body) {
        this.activeLanded = true;
        SFX.sfxLand();
        const p = this.active.body.position;
        this.burst(p.x, this.active.body.bounds.max.y, this.active.spec.color, 7, false);
        this.cam.shakeMag = Math.max(this.cam.shakeMag, 4);
        break;
      }
    }
  }

  // ---------- render ----------

  private render() {
    const ctx = this.ctx;
    const alt = this.phase === "home" ? this.currentHeightM() : this.currentHeightM();
    const sky = sampleSky(alt);

    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, rgb(sky.top));
    g.addColorStop(0.55, rgb(sky.mid));
    g.addColorStop(1, rgb(sky.bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // low sun glow near the horizon (fades with altitude)
    const sunA = Math.max(0, 1 - altitudeNorm(alt) * 2.6);
    if (sunA > 0.01) {
      const gy = this.sy(PLATFORM_TOP_Y) + 30;
      const rg = ctx.createRadialGradient(this.W * 0.5, gy, 0, this.W * 0.5, gy, this.W * 0.7);
      rg.addColorStop(0, withAlpha("#FFE3B0", 0.5 * sunA));
      rg.addColorStop(1, "rgba(255,220,160,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    this.drawStars(sky.stars);
    this.drawAltitudeLines();
    this.drawPedestal();

    for (const b of this.blocks) this.drawBlock(b);
    // dimension labels drawn in a separate pass so later blocks never cover them
    if (this.phase !== "home") {
      for (const b of this.blocks) this.drawBlockDimLabel(b);
    }
    if (this.awaiting && this.pending && this.phase === "playing") this.drawPreview();
    this.drawParticles();
    this.drawWobbleVignette();
    this.drawMinimap();
  }

  /**
   * Right-side overview: a true, shrunk-down replica of the whole tower (pedestal
   * base → current tip). Crucially it uses ONE uniform scale for both x and y —
   * `min(innerW / towerWidth, innerH / towerHeight)` — so every block keeps its
   * real width, height, tilt and sideways offset (a lopsided tower reads as a
   * lopsided miniature; wide blocks stay wide, narrow blocks stay narrow). The
   * panel width adapts to the tower's real aspect ratio (a short/wide stack gets
   * a wider panel, a tall stack a narrow one) but stays clamped to a responsive
   * range so it never covers the play field, HUD or buttons. A box marks the
   * slice the main camera is currently showing. Compact on narrow screens (phones get a thin strip).
   */
  // 폰처럼 좁은 화면에선 패널을 가늘게 줄여서 보여 준다(예전엔 460px 미만이면 숨겼다).
  private miniTiny(): boolean {
    return this.W < 460;
  }
  private miniMargin(): number {
    return (this.miniTiny() ? 6 : 12) + this.safe.right;
  }
  private miniTinyPanelW(): number {
    return Math.min(40, this.W * 0.08) + 8; // 안쪽 폭 상한 + 좌우 패딩 4px×2
  }

  private drawMinimap() {
    if (this.phase === "home") return;
    const ctx = this.ctx;
    const tiny = this.miniTiny();

    // --- panel vertical extent (clears top HUD and bottom controls, notch-aware) ---
    const margin = this.miniMargin();
    // 좁은 화면 게임 중엔 🔊 버튼이 HUD 바로 아래 오른쪽으로 내려오므로(App.tsx) 그만큼 더 비운다.
    const pTop = this.hudBottom() + (this.phase === "playing" && this.W < 560 ? 48 : 0);
    const pBottom = this.controlsTop();
    const pH = pBottom - pTop;
    if (pH < 150) return; // not enough vertical room -> skip
    const padX = tiny ? 4 : 8;
    const padY = tiny ? 6 : 10;
    const radius = tiny ? 8 : 12;
    const innerH = pH - padY * 2;

    // --- world bounding box of the WHOLE tower (pedestal base → highest tip) ---
    const baseY = PLATFORM_TOP_Y + PLATFORM_HEIGHT; // bottom of the pedestal
    let minX = -PLATFORM_WIDTH / 2;
    let maxX = PLATFORM_WIDTH / 2;
    let topWorld = PLATFORM_TOP_Y;
    for (const b of this.blocks) {
      minX = Math.min(minX, b.body.bounds.min.x);
      maxX = Math.max(maxX, b.body.bounds.max.x);
      topWorld = Math.min(topWorld, b.body.bounds.min.y);
    }
    if (this.active) {
      minX = Math.min(minX, this.active.body.bounds.min.x);
      maxX = Math.max(maxX, this.active.body.bounds.max.x);
      topWorld = Math.min(topWorld, this.active.body.bounds.min.y);
    }
    // a little breathing room around the tower's real footprint
    minX -= 10;
    maxX += 10;
    topWorld -= 24;
    const towerW = Math.max(maxX - minX, 1);
    const towerH = Math.max(baseY - topWorld, 1);

    // --- adaptive panel width: derive from the height-limited scale so the true
    //     (uniformly scaled) miniature fits without wasting/cramping space, then
    //     clamp to a responsive range that keeps the panel out of the way. ---
    const compact = this.W < 760;
    const desiredInnerW = towerW * (innerH / towerH);
    const minInnerW = tiny ? 16 : compact ? 28 : 42;
    const maxInnerW = tiny
      ? this.miniTinyPanelW() - padX * 2
      : Math.min(compact ? 84 : 140, this.W * (compact ? 0.24 : 0.2));
    const targetPanelW = Math.max(minInnerW, Math.min(maxInnerW, desiredInnerW)) + padX * 2;
    // smooth width changes so adding blocks doesn't make the panel jump around
    this.miniPanelW = this.miniPanelW > 0 ? this.miniPanelW + (targetPanelW - this.miniPanelW) * 0.16 : targetPanelW;
    const panelW = Math.round(this.miniPanelW);
    const px = this.W - panelW - margin;
    const innerW = panelW - padX * 2;

    // ONE uniform scale for x AND y — this is what makes it a real replica.
    const scale = Math.min(innerW / towerW, innerH / towerH);

    // horizontally centre the tower's bbox; stand it on the panel floor so it
    // grows upward like the real thing (base anchored to the bottom).
    const midX = (minX + maxX) / 2;
    const cx = px + panelW / 2;
    const floorY = pBottom - padY;
    const mx = (wx: number) => cx + (wx - midX) * scale;
    const my = (wy: number) => floorY - (baseY - wy) * scale;

    ctx.save();
    // panel background
    roundRect(ctx, px, pTop, panelW, pH, radius);
    ctx.fillStyle = "rgba(9,13,32,0.42)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // keep every mark inside the rounded panel
    roundRect(ctx, px, pTop, panelW, pH, radius);
    ctx.clip();

    // camera viewport slice (what the main view is currently showing)
    const viewTop = my(this.cam.y - this.H / 2 / this.cam.zoom);
    const viewBot = my(this.cam.y + this.H / 2 / this.cam.zoom);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(px, viewTop, panelW, viewBot - viewTop);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 2, viewTop, panelW - 4, viewBot - viewTop);

    // pedestal — real footprint at the uniform scale
    const pl = mx(-PLATFORM_WIDTH / 2);
    const pr = mx(PLATFORM_WIDTH / 2);
    const pTopY = my(PLATFORM_TOP_Y);
    const pBotY = my(baseY);
    ctx.fillStyle = "rgba(120,150,220,0.55)";
    ctx.fillRect(pl, pTopY, pr - pl, Math.max(2, pBotY - pTopY));

    // blocks — real shape (footprint polygon / circle), real colour, real tilt
    for (const b of this.blocks) this.drawMinimapBlock(ctx, b, mx, my, scale, 1);
    if (this.active) this.drawMinimapBlock(ctx, this.active, mx, my, scale, 0.7);

    ctx.restore();
  }

  /** Draw one block into the minimap at the uniform scale, preserving its actual
   *  footprint (vertices) and orientation — not just a bounding bar. */
  private drawMinimapBlock(
    ctx: CanvasRenderingContext2D,
    b: Block,
    mx: (x: number) => number,
    my: (y: number) => number,
    scale: number,
    alpha: number,
  ) {
    const { body, spec } = b;
    const wpx = (body.bounds.max.x - body.bounds.min.x) * scale;
    const hpx = (body.bounds.max.y - body.bounds.min.y) * scale;
    const stroke = Math.min(wpx, hpx) > 5; // outline only when big enough to read
    ctx.globalAlpha = alpha;
    ctx.fillStyle = spec.color;

    if (spec.radius != null) {
      const ccx = mx(body.position.x);
      const ccy = my(body.position.y);
      const r = Math.max(1, spec.radius * scale);
      ctx.beginPath();
      ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = darken(spec.color, 0.3);
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    for (const part of parts) {
      const v = part.vertices;
      ctx.beginPath();
      ctx.moveTo(mx(v[0].x), my(v[0].y));
      for (let i = 1; i < v.length; i++) ctx.lineTo(mx(v[i].x), my(v[i].y));
      ctx.closePath();
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = darken(spec.color, 0.3);
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawStars(amount: number) {
    if (amount <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    for (const s of this.stars) {
      const sxp = s.x * this.W;
      let syp = (((s.y + this.cam.y * 0.00035) % 1) + 1) % 1;
      syp *= this.H;
      const tw = 0.55 + 0.45 * Math.sin(this.time * 0.002 * s.tw + s.phase);
      ctx.globalAlpha = amount * tw;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(sxp, syp, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawAltitudeLines() {
    const ctx = this.ctx;
    const topY = this.cam.y - this.H / 2 / this.cam.zoom;
    const topM = Math.ceil(heightMeters(topY) / 10) * 10;
    ctx.save();
    ctx.font = "600 12px -apple-system, sans-serif";
    for (let m = 0; m <= topM + 10; m += 10) {
      const wy = PLATFORM_TOP_Y - m * PIXELS_PER_METER;
      const y = this.sy(wy);
      if (y < -20 || y > this.H + 20) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.W, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.fillText(`${m}m`, 12, y - 4);
    }
    ctx.restore();
  }

  private drawPedestal() {
    const ctx = this.ctx;
    const leftW = this.sx(-PLATFORM_WIDTH / 2);
    const rightW = this.sx(PLATFORM_WIDTH / 2);
    const topY = this.sy(PLATFORM_TOP_Y);
    const botY = this.sy(PLATFORM_TOP_Y + PLATFORM_HEIGHT);
    const w = rightW - leftW;
    const r = Math.min(14, w / 4);

    // pillar descending into the depths
    ctx.save();
    const pg = ctx.createLinearGradient(0, botY, 0, this.H);
    pg.addColorStop(0, "#1a2145");
    pg.addColorStop(1, "#0a0e24");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.moveTo(leftW + w * 0.14, botY);
    ctx.lineTo(rightW - w * 0.14, botY);
    ctx.lineTo(rightW - w * 0.28, this.H + 40);
    ctx.lineTo(leftW + w * 0.28, this.H + 40);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // platform slab
    ctx.save();
    const slab = ctx.createLinearGradient(0, topY, 0, botY);
    slab.addColorStop(0, "#3a4780");
    slab.addColorStop(1, "#1b2350");
    roundRect(ctx, leftW, topY, w, botY - topY, r);
    ctx.fillStyle = slab;
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fill();
    ctx.restore();

    // glowing landing surface
    ctx.save();
    ctx.strokeStyle = withAlpha("#8fe6ff", 0.85);
    ctx.lineWidth = 3;
    ctx.shadowColor = withAlpha("#8fe6ff", 0.9);
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(leftW + 8, topY);
    ctx.lineTo(rightW - 8, topY);
    ctx.stroke();
    ctx.restore();
  }

  private drawBlock(b: Block) {
    const ctx = this.ctx;
    const { body, spec } = b;
    ctx.save();

    if (spec.radius != null) {
      const cx = this.sx(body.position.x);
      const cy = this.sy(body.position.y);
      const r = spec.radius * this.cam.zoom;
      const rg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      rg.addColorStop(0, lighten(spec.color, 0.32));
      rg.addColorStop(1, darken(spec.color, 0.08));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = darken(spec.color, 0.3);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // spin indicator
      ctx.fillStyle = withAlpha("#ffffff", 0.55);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(body.angle) * r * 0.5, cy + Math.sin(body.angle) * r * 0.5, Math.max(1.5, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    const bt = this.sy(body.bounds.min.y);
    const bb = this.sy(body.bounds.max.y);
    const grad = ctx.createLinearGradient(0, bt, 0, bb);
    grad.addColorStop(0, lighten(spec.color, 0.28));
    grad.addColorStop(0.5, spec.color);
    grad.addColorStop(1, darken(spec.color, 0.1));

    for (const part of parts) {
      const v = part.vertices;
      ctx.beginPath();
      ctx.moveTo(this.sx(v[0].x), this.sy(v[0].y));
      for (let i = 1; i < v.length; i++) ctx.lineTo(this.sx(v[i].x), this.sy(v[i].y));
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = darken(spec.color, 0.28);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPreview() {
    if (!this.pending) return;
    const ctx = this.ctx;
    const spec = this.pending;
    const angle = this.aimAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const worldBottom = this.settledTopY() - HOVER_GAP;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.005);

    // gather rotated local geometry to align the footprint like the real body
    const isCircle = spec.radius != null;
    const polys = isCircle
      ? [rectCorners(0, 0, spec.radius! * 2, spec.radius! * 2)]
      : specPolys(spec);
    const rot = (p: { x: number; y: number }) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const rpolys = polys.map((poly) =>
      poly.map((p) => {
        const r = rot(p);
        if (r.x < minX) minX = r.x;
        if (r.x > maxX) maxX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.y > maxY) maxY = r.y;
        return r;
      }),
    );
    const bcx = (minX + maxX) / 2;
    const hbox = maxY - minY;
    const centerY = worldBottom - hbox / 2;
    const toScreen = (p: { x: number; y: number }): [number, number] => [
      this.sx(this.aimX + (p.x - bcx)),
      this.sy(centerY + (p.y - (minY + maxY) / 2)),
    ];

    // drop guide line
    const gx = this.sx(this.aimX);
    const gyTop = this.sy(worldBottom);
    const gyBot = this.sy(this.settledTopY());
    ctx.save();
    ctx.strokeStyle = withAlpha(spec.color, 0.35 + 0.25 * pulse);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(gx, gyTop);
    ctx.lineTo(gx, gyBot);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = withAlpha(spec.color, 0.6 + 0.3 * pulse);
    ctx.beginPath();
    ctx.moveTo(gx - 7, gyBot - 12);
    ctx.lineTo(gx + 7, gyBot - 12);
    ctx.lineTo(gx, gyBot - 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // the ghost block
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2.5;
    if (isCircle) {
      const c = toScreen({ x: 0, y: 0 });
      const r = spec.radius! * this.cam.zoom;
      ctx.beginPath();
      ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(spec.color, 0.3);
      ctx.fill();
      ctx.strokeStyle = lighten(spec.color, 0.2);
      ctx.stroke();
    } else {
      for (const poly of rpolys) {
        ctx.beginPath();
        const p0 = toScreen(poly[0]);
        ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < poly.length; i++) {
          const p = toScreen(poly[i]);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.fillStyle = withAlpha(spec.color, 0.3);
        ctx.fill();
        ctx.strokeStyle = lighten(spec.color, 0.2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // prominent size read-out for the block being aimed — sit it just above the
    // ghost's top so you always know the dimensions before dropping. If that
    // would clip under the HUD, drop it onto the block centre instead.
    const topScreen = this.sy(centerY - hbox / 2);
    let labelY = topScreen - 16;
    if (labelY < 128) labelY = this.sy(centerY);
    this.drawDimLabel(dimLabel(spec), this.sx(this.aimX), labelY, true);
  }

  /** Small size label centred on a settled block (skipped when too small on screen). */
  private drawBlockDimLabel(b: Block) {
    if (!b.settled) return;
    const { body, spec } = b;
    const wpx = (body.bounds.max.x - body.bounds.min.x) * this.cam.zoom;
    const hpx = (body.bounds.max.y - body.bounds.min.y) * this.cam.zoom;
    // too small to carry a readable label -> omit (keeps a tall tower uncluttered)
    if (Math.min(wpx, hpx) < 24 || wpx < 38) return;
    const sx = this.sx(body.position.x);
    const sy = this.sy(body.position.y);
    if (sx < -80 || sx > this.W + 80 || sy < -24 || sy > this.H + 24) return;
    this.drawDimLabel(dimLabel(spec), sx, sy, false);
  }

  /**
   * Draw a size label as a pill so it reads over any block colour. Text is a
   * FIXED pixel size (independent of camera zoom) — emphasised labels are larger
   * and outlined for the block currently being aimed / previewed.
   */
  private drawDimLabel(text: string, sx: number, sy: number, emphasis: boolean) {
    const ctx = this.ctx;
    const fs = emphasis ? 15 : 11;
    ctx.save();
    ctx.font = `700 ${fs}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padX = emphasis ? 9 : 5;
    const padY = emphasis ? 5 : 3;
    const bw = ctx.measureText(text).width + padX * 2;
    const bh = fs + padY * 2;
    roundRect(ctx, sx - bw / 2, sy - bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = emphasis ? "rgba(9,13,32,0.8)" : "rgba(9,13,32,0.62)";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = emphasis ? 8 : 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (emphasis) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.fillStyle = emphasis ? "#FFE7B0" : "rgba(255,255,255,0.94)";
    ctx.fillText(text, sx, sy + 0.5);
    ctx.restore();
  }

  private drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    for (const p of this.particles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = alpha;
      const x = this.sx(p.x);
      const y = this.sy(p.y);
      const s = p.size * this.cam.zoom;
      ctx.fillStyle = p.color;
      if (p.confetti) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.fillRect(-s / 2, -s / 2, s, s * 0.6);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawWobbleVignette() {
    if (this.wobble <= 0.05) return;
    const ctx = this.ctx;
    const a = Math.min(0.5, this.wobble * 0.55);
    const rg = ctx.createRadialGradient(
      this.W / 2,
      this.H / 2,
      Math.min(this.W, this.H) * 0.35,
      this.W / 2,
      this.H / 2,
      Math.max(this.W, this.H) * 0.75,
    );
    rg.addColorStop(0, "rgba(255,80,80,0)");
    rg.addColorStop(1, `rgba(255,60,60,${a})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  // ---------- loop ----------

  private loop = (ts: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(50, ts - this.lastTs);
    this.lastTs = ts;
    this.time += dt;

    if (this.phase === "playing" || this.phase === "gameover" || this.phase === "clear") {
      this.updateSwing();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5) {
        this.step(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
    } else {
      // home: keep particles/twinkle alive but freeze physics
      this.updateParticles(dt);
    }

    this.updateCamera(dt);
    this.render();
    this.emit(false);
  };

  private emit(force: boolean) {
    const hud: HudState = {
      phase: this.phase,
      placed: this.placedCount,
      total: TOTAL_BLOCKS,
      heightM: this.currentHeightM(),
      peakM: Math.max(this.peakHeightM, this.currentHeightM()),
      peakBlocks: Math.max(this.peakBlocks, this.placedCount),
      bestM: this.record.heightM,
      bestBlocks: this.record.blocks,
      awaitingDrop: this.awaiting,
      altitude01: altitudeNorm(this.currentHeightM()),
      wobble: this.wobble,
      cleared: this.cleared,
      next:
        this.phase === "playing" && this.nextSpec
          ? {
              kind: this.nextSpec.kind,
              color: this.nextSpec.color,
              w: this.nextSpec.w,
              h: this.nextSpec.h,
              radius: this.nextSpec.radius,
            }
          : null,
    };
    const key = `${hud.phase}|${hud.placed}|${hud.awaitingDrop}|${hud.heightM.toFixed(1)}|${hud.wobble > 0.28}|${hud.next?.kind ?? ""}|${hud.next?.color ?? ""}`;
    const now = this.time;
    if (force || key !== this.lastEmitKey || now - this.lastEmit > 140) {
      this.lastEmitKey = key;
      this.lastEmit = now;
      this.onState(hud);
    }
  }

  // ---------- input ----------
  // The block auto-swings left↔right; a tap/click anywhere (or Space/Enter)
  // drops it at its current x. No drag-aiming any more.

  private bindInput() {
    const c = this.canvas;
    const onDown = (e: PointerEvent) => {
      if (this.phase !== "playing" || !this.awaiting) return;
      SFX.primeAudio();
      this.drop();
      e.preventDefault();
    };
    c.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", this.onKey);
    this.cleanups.push(
      () => c.removeEventListener("pointerdown", onDown),
      () => window.removeEventListener("keydown", this.onKey),
    );
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.phase !== "playing") return;
    switch (e.key) {
      case "ArrowUp":
      case "q":
      case "Q":
        this.rotate(-1);
        e.preventDefault();
        break;
      case "e":
      case "E":
        this.rotate(1);
        e.preventDefault();
        break;
      case " ":
      case "Enter":
        this.drop();
        e.preventDefault();
        break;
    }
  };

  // ---------- resize ----------

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = w;
    this.H = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.safe = readSafeArea();
  }

  // ---------- score card ----------

  captureScoreCard(): string {
    // On collapse the live blocks are already tumbling, so fall back to the
    // snapshot taken at the last placement (intact tower). On clear the tower
    // still stands, so render live to include the "완주 성공!" state.
    if (this.phase === "gameover" && this.lastCard) return this.lastCard;
    return this.renderScoreCard();
  }

  private renderScoreCard(): string {
    const W = 1080;
    const H = 1350;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d")!;
    // report the peak reached this run, not the (possibly collapsed) live height
    const alt = Math.max(this.peakHeightM, this.currentHeightM());
    const sky = sampleSky(alt);

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(sky.top));
    g.addColorStop(0.55, rgb(sky.mid));
    g.addColorStop(1, rgb(sky.bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    if (sky.stars > 0.05) {
      ctx.fillStyle = "#fff";
      for (const s of this.stars) {
        ctx.globalAlpha = sky.stars * (0.4 + 0.6 * s.x);
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H * 0.6, s.r * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // fit tower into a region
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = PLATFORM_TOP_Y + PLATFORM_HEIGHT;
    for (const b of this.blocks) {
      minX = Math.min(minX, b.body.bounds.min.x);
      maxX = Math.max(maxX, b.body.bounds.max.x);
      minY = Math.min(minY, b.body.bounds.min.y);
    }
    if (!isFinite(minX)) {
      minX = -PLATFORM_WIDTH / 2;
      maxX = PLATFORM_WIDTH / 2;
      minY = 0;
    }
    const towerW = Math.max(PLATFORM_WIDTH, maxX - minX) + 60;
    const towerH = maxY - minY + 40;
    const regionX = 120;
    const regionY = 430;
    const regionW = W - 240;
    const regionH = H - regionY - 150;
    const scale = Math.min(regionW / towerW, regionH / towerH);
    const midX = (minX + maxX) / 2;
    const ox = regionX + regionW / 2 - midX * scale;
    const oy = regionY + regionH - (maxY - 0) * scale - 10;

    const sxT = (wx: number) => ox + wx * scale;
    const syT = (wy: number) => oy + wy * scale;

    // pedestal
    ctx.fillStyle = "#20295a";
    roundRect(ctx, sxT(-PLATFORM_WIDTH / 2), syT(PLATFORM_TOP_Y), PLATFORM_WIDTH * scale, PLATFORM_HEIGHT * scale, 10);
    ctx.fill();

    // blocks
    for (const b of this.blocks) {
      const spec = b.spec;
      if (spec.radius != null) {
        const cx = sxT(b.body.position.x);
        const cy = syT(b.body.position.y);
        const r = spec.radius * scale;
        ctx.fillStyle = spec.color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const parts = b.body.parts.length > 1 ? b.body.parts.slice(1) : [b.body];
      for (const part of parts) {
        const v = part.vertices;
        ctx.beginPath();
        ctx.moveTo(sxT(v[0].x), syT(v[0].y));
        for (let i = 1; i < v.length; i++) ctx.lineTo(sxT(v[i].x), syT(v[i].y));
        ctx.closePath();
        ctx.fillStyle = spec.color;
        ctx.fill();
        ctx.strokeStyle = darken(spec.color, 0.28);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // text
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 40px -apple-system, sans-serif";
    ctx.fillText(this.cleared ? "완주 성공!" : "기록", W / 2, 120);

    const grad = ctx.createLinearGradient(W / 2 - 260, 0, W / 2 + 260, 0);
    grad.addColorStop(0, "#FFD166");
    grad.addColorStop(1, "#FF6B9D");
    ctx.fillStyle = grad;
    ctx.font = "800 150px -apple-system, sans-serif";
    ctx.fillText(`${alt.toFixed(1)}m`, W / 2, 300);

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "600 44px -apple-system, sans-serif";
    ctx.fillText(`블록 ${Math.max(this.peakBlocks, this.placedCount)} / ${TOTAL_BLOCKS}`, W / 2, 380);

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "700 40px -apple-system, sans-serif";
    ctx.fillText("높이 높이 · Higher Higher", W / 2, H - 70);

    return cv.toDataURL("image/png");
  }

  // ---------- test hooks ----------

  private exposeTestHooks() {
    (window as unknown as { __hh: unknown }).__hh = {
      start: () => this.start(),
      reset: () => this.reset(),
      drop: () => this.drop(),
      setAim: (x: number) => this.setAim(x),
      rotate: (d: number) => this.rotate(d),
      state: () => ({
        phase: this.phase,
        placed: this.placedCount,
        awaitingDrop: this.awaiting,
        heightM: this.currentHeightM(),
        peakM: Math.max(this.peakHeightM, this.currentHeightM()),
        peakBlocks: Math.max(this.peakBlocks, this.placedCount),
        bestM: this.record.heightM,
        bestBlocks: this.record.blocks,
        settledTopY: this.settledTopY(),
        topX: this.topBlockCenterX(),
        topY: this.topBlockTopY(),
        topAngle: this.topBlockAngle(),
        blocks: this.blocks.length,
        aimX: this.aimX,
        wobble: this.wobble,
        cleared: this.cleared,
        pendingKind: this.pending?.kind ?? null,
        pendingColor: this.pending?.color ?? null,
        nextKind: this.nextSpec?.kind ?? null,
        nextColor: this.nextSpec?.color ?? null,
      }),
      /** deterministically sample block kinds across the whole difficulty ramp */
      sampleKinds: (n: number) => {
        const rng = mulberry32(0xc0ffee);
        const counts: Record<string, number> = {};
        for (let i = 0; i < n; i++) {
          const s = makeBlockSpec(100000 + i, i % 130, rng);
          counts[s.kind] = (counts[s.kind] ?? 0) + 1;
        }
        return counts;
      },
    };
  }

  destroy() {
    SFX.stopBgm();
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    Events.off(this.engine, "collisionStart");
    Composite.clear(this.world, false, true);
    Engine.clear(this.engine);
  }
}

/** 노치·홈바 안전 영역(px). env() 는 CSS 에서만 읽히므로 보이지 않는 요소에 패딩으로 걸어 잰다. */
function readSafeArea(): { top: number; right: number; bottom: number } {
  const p = document.createElement("div");
  p.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) 0";
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const r = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
  };
  p.remove();
  return r;
}

// ---------- small drawing helpers ----------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function rectCorners(cx: number, cy: number, w: number, h: number) {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

function specPolys(spec: BlockSpec): { x: number; y: number }[][] {
  if (spec.radius != null) return [];
  if (spec.parts) return spec.parts.map((p) => rectCorners(p.x, p.y, p.w, p.h));
  if (spec.vertices) return [spec.vertices];
  return [rectCorners(0, 0, spec.w, spec.h)];
}
