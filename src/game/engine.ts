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
  TOTAL_BLOCKS,
} from "./constants";
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
  type Record as HRecord,
} from "./logic";
import { mulberry32, randRange, type Rng } from "./rng";
import { makeBlockSpec } from "./shapes";
import * as SFX from "./audio";
import type { BlockSpec, HudState, Phase } from "./types";

const { Engine, Bodies, Body, Composite, Events } = Matter;

const HOVER_GAP = 20; // air gap between preview bottom and tower top
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
  friction: 0.72,
  frictionStatic: 1.5,
  restitution: 0,
  density: 0.002,
  frictionAir: 0.02,
  slop: 0.02,
};

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onState: (h: HudState) => void;

  private engine: Matter.Engine;
  private world: Matter.World;
  private platform!: Matter.Body;

  private blocks: Block[] = [];
  private pending: BlockSpec | null = null;
  private active: Block | null = null;
  private activeLanded = false;
  private calm = 0;
  private dropAt = 0;

  private placedCount = 0;
  private idCounter = 1;
  private lastColor: string | undefined;
  private rng: Rng;

  private phase: Phase = "home";
  private cleared = false;

  private aimX = 0;
  private aimAngle = 0;
  private awaiting = false;

  private cam = { y: -140, zoom: 1, shakeX: 0, shakeY: 0, shakeMag: 0, offsetX: 0 };
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private wobble = 0;
  private warnCooldown = 0;

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

  // pointer state
  private ptrActive = false;
  private ptrMoved = false;
  private ptrStartX = 0;
  private ptrStartY = 0;
  private cleanups: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, onState: (h: HudState) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.onState = onState;
    this.record = loadRecord();

    const seedParam = new URLSearchParams(window.location.search).get("seed");
    const seed = seedParam ? Number(seedParam) >>> 0 : (Math.random() * 1e9) >>> 0;
    this.rng = mulberry32(seed);

    this.engine = Engine.create();
    this.engine.enableSleeping = true;
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.001;
    this.engine.positionIterations = 16;
    this.engine.velocityIterations = 12;
    this.engine.constraintIterations = 4;
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
    this.particles = [];
  }

  // ---------- game flow ----------

  start() {
    SFX.primeAudio();
    this.clearBlocks();
    this.placedCount = 0;
    this.cleared = false;
    this.wobble = 0;
    this.lastColor = undefined;
    this.phase = "playing";
    this.aimX = 0;
    this.aimAngle = 0;
    this.spawnPending();
    this.snapCamera();
    this.emit(true);
  }

  reset() {
    this.record = loadRecord();
    this.start();
  }

  goHome() {
    this.record = loadRecord();
    this.buildDemo();
  }

  private spawnPending() {
    const idx = this.placedCount;
    this.pending = makeBlockSpec(this.idCounter++, idx, this.rng, this.lastColor);
    this.lastColor = this.pending.color;
    this.aimX = 0;
    this.aimAngle = 0;
    this.awaiting = true;
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

  nudge(dir: number) {
    this.setAim(this.aimX + dir * 10);
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
    SFX.sfxPlace();
    this.burst(b.body.position.x, b.body.bounds.min.y, b.spec.color, 10, false);
    if (isCleared(this.placedCount, TOTAL_BLOCKS)) {
      this.clearGame();
    } else {
      this.spawnPending();
    }
    this.emit(true);
  }

  private clearGame() {
    this.phase = "clear";
    this.cleared = true;
    const h = this.currentHeightM();
    this.record = saveRecord(h, this.placedCount);
    SFX.sfxClear();
    this.confetti();
    this.emit(true);
  }

  private triggerGameOver() {
    if (this.phase !== "playing") return;
    this.phase = "gameover";
    this.active = null;
    this.awaiting = false;
    const h = this.currentHeightM();
    this.record = saveRecord(h, this.placedCount);
    this.cam.shakeMag = 14;
    SFX.sfxCollapse();
    this.emit(true);
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

  /** centre-x of the highest settled block (the surface the next block lands on) */
  private topBlockCenterX(): number {
    let topY = Infinity;
    let x = 0;
    for (const b of this.blocks) {
      if (b.settled && b.body.bounds.min.y < topY) {
        topY = b.body.bounds.min.y;
        x = b.body.position.x;
      }
    }
    return x;
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
    const zoom = Math.max(0.5, Math.min(1.5, baseZoom * (1 - 0.1 * altitudeNorm(alt))));
    const focus = this.focusTopY();
    const camY = focus - (FOCUS_FRAC * this.H - this.H / 2) / zoom;
    return { camY, zoom };
  }

  private targetOffsetX(): number {
    const wide = this.W / this.H > 1.25;
    return this.phase === "home" && wide ? this.W * 0.2 : 0;
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
    if (this.awaiting && this.pending && this.phase === "playing") this.drawPreview();
    this.drawParticles();
    this.drawWobbleVignette();
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
      bestM: this.record.heightM,
      bestBlocks: this.record.blocks,
      awaitingDrop: this.awaiting,
      altitude01: altitudeNorm(this.currentHeightM()),
      wobble: this.wobble,
      cleared: this.cleared,
    };
    const key = `${hud.phase}|${hud.placed}|${hud.awaitingDrop}|${hud.heightM.toFixed(1)}|${hud.wobble > 0.28}`;
    const now = this.time;
    if (force || key !== this.lastEmitKey || now - this.lastEmit > 140) {
      this.lastEmitKey = key;
      this.lastEmit = now;
      this.onState(hud);
    }
  }

  // ---------- input ----------

  private worldFromClientX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    return (localX - this.W / 2 - this.cam.shakeX) / this.cam.zoom;
  }

  private bindInput() {
    const c = this.canvas;
    const onDown = (e: PointerEvent) => {
      if (this.phase !== "playing" || !this.awaiting) return;
      SFX.primeAudio();
      this.ptrActive = true;
      this.ptrMoved = false;
      this.ptrStartX = e.clientX;
      this.ptrStartY = e.clientY;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!this.ptrActive) return;
      const dx = e.clientX - this.ptrStartX;
      const dy = e.clientY - this.ptrStartY;
      if (Math.hypot(dx, dy) > 7) this.ptrMoved = true;
      if (this.ptrMoved) this.setAim(this.worldFromClientX(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      if (!this.ptrActive) return;
      this.ptrActive = false;
      if (!this.ptrMoved) this.drop();
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onCancel = () => {
      this.ptrActive = false;
    };
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", this.onKey);
    this.cleanups.push(
      () => c.removeEventListener("pointerdown", onDown),
      () => c.removeEventListener("pointermove", onMove),
      () => c.removeEventListener("pointerup", onUp),
      () => c.removeEventListener("pointercancel", onCancel),
      () => window.removeEventListener("keydown", this.onKey),
    );
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.phase !== "playing") return;
    switch (e.key) {
      case "ArrowLeft":
        this.nudge(-1);
        e.preventDefault();
        break;
      case "ArrowRight":
        this.nudge(1);
        e.preventDefault();
        break;
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
  }

  // ---------- score card ----------

  captureScoreCard(): string {
    const W = 1080;
    const H = 1350;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d")!;
    const alt = this.currentHeightM();
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
    ctx.fillText(`블록 ${this.placedCount} / ${TOTAL_BLOCKS}`, W / 2, 380);

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
        settledTopY: this.settledTopY(),
        topX: this.topBlockCenterX(),
        blocks: this.blocks.length,
        aimX: this.aimX,
        wobble: this.wobble,
        cleared: this.cleared,
      }),
    };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    Events.off(this.engine, "collisionStart");
    Composite.clear(this.world, false, true);
    Engine.clear(this.engine);
  }
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
