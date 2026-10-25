import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { StaticMap } from '../worker/protocol';
import type { ArmyInfo } from '../sim/snapshot';
import { fbm } from '../sim/noise';

const SEA_ID = 0xffff;
const WASTE_ID = 0xfffe;

/** Pack RGBA into the little-endian ABGR layout of an ImageData Uint32 view. */
export function abgr(rgb: number, a = 255): number {
  return ((a << 24) | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
}

function shade(rgb: number, k: number): number {
  const r = Math.min(255, Math.max(0, ((rgb >> 16) & 0xff) * k));
  const g = Math.min(255, Math.max(0, ((rgb >> 8) & 0xff) * k));
  const b = Math.min(255, Math.max(0, (rgb & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

const TERRAIN_RGB = [0xa8a46c, 0x918a5e, 0x7c7260, 0x86a25e, 0xb6a877];

export interface Palette {
  /** Fill color per province (0xRRGGBB). */
  color: Uint32Array;
  /** Fill alpha per province, 0-255. */
  alpha: Uint8Array;
  /** Group per province; borders between groups are drawn heavy. */
  group: Int32Array;
  /** Occupier color per province or -1. */
  stripe: Int32Array;
}

export interface MapCallbacks {
  onClick(p: number, button: number): void;
  onHover(p: number, x: number, y: number): void;
  onFrame(renderMs: number): void;
}

interface ArmySprite {
  g: Graphics;
  t: Text;
}

/**
 * The map: a province-id bitmap drawn as two textured layers (static terrain drawn
 * once, political overlay recolored only when ownership changes) plus an overlay of
 * markers. Picking is a single pixel lookup. Nothing renders unless something changed.
 */
export class MapRenderer {
  app = new Application();
  private map!: StaticMap;
  private world = new Container();
  private terrainSprite!: Sprite;
  private politicalSprite!: Sprite;
  private politicalCanvas!: HTMLCanvasElement;
  private politicalCtx!: CanvasRenderingContext2D;
  private image!: ImageData;
  private pixels!: Uint32Array;
  private politicalTex!: Texture;
  private borderNb!: Int32Array;
  private labels = new Container();
  private markers = new Container();
  private armyLayer = new Container();
  private armySprites = new Map<number, ArmySprite>();
  private route = new Graphics();
  private renderQueued = false;
  private zoom = 1;
  private minZoom = 0.5;
  private cb: MapCallbacks;
  private hoverProv = -1;
  private destroyed = false;

  constructor(cb: MapCallbacks) {
    this.cb = cb;
  }

  async init(host: HTMLElement, map: StaticMap): Promise<void> {
    this.map = map;
    await this.app.init({ resizeTo: host, background: 0x13283b, antialias: true, autoStart: false, preference: 'webgl', resolution: window.devicePixelRatio || 1, autoDensity: true });
    if (this.destroyed) return;
    this.app.ticker.stop();
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);

    const { width: W, height: H } = map;
    const terrainCanvas = this.buildTerrain();
    const tt = Texture.from(terrainCanvas, true);
    tt.source.scaleMode = 'linear';
    this.terrainSprite = new Sprite(tt);
    this.world.addChild(this.terrainSprite);

    this.politicalCanvas = document.createElement('canvas');
    this.politicalCanvas.width = W;
    this.politicalCanvas.height = H;
    this.politicalCtx = this.politicalCanvas.getContext('2d')!;
    this.image = this.politicalCtx.createImageData(W, H);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.politicalTex = Texture.from(this.politicalCanvas, true);
    this.politicalTex.source.scaleMode = 'nearest';
    this.politicalSprite = new Sprite(this.politicalTex);
    this.world.addChild(this.politicalSprite);
    this.world.addChild(this.markers);
    this.world.addChild(this.labels);
    this.world.addChild(this.route);
    this.world.addChild(this.armyLayer);

    this.buildBorders();
    this.fit();
    this.bindInput();
    window.addEventListener('resize', this.onResize);
    this.requestRender();
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('resize', this.onResize);
    try {
      this.app.destroy(true, { children: true, texture: true });
    } catch {
      // init may not have finished
    }
  }

  private onResize = () => {
    // ResizePlugin resizes on its own; we just need a frame afterwards.
    setTimeout(() => this.requestRender(), 30);
  };

  /** Static terrain: sea depth, desert, and land texture. Drawn once. */
  private buildTerrain(): HTMLCanvasElement {
    const { width: W, height: H, ids, provinceCount: P, terrain } = this.map;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer);
    // Distance from coast over water, for shallow-water shading.
    const dist = new Uint8Array(W * H).fill(255);
    const q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    for (let i = 0; i < W * H; i++) {
      if (ids[i] !== SEA_ID) {
        dist[i] = 0;
        q[qt++] = i;
      }
    }
    while (qh < qt) {
      const i = q[qh++];
      const d = dist[i];
      if (d >= 40) continue;
      const x = i % W;
      const nbs = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const n of nbs) {
        if (n < 0 || n >= W * H || dist[n] !== 255) continue;
        dist[n] = d + 1;
        q[qt++] = n;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const id = ids[i];
        const n = fbm(x / 24, y / 24, 77, 3);
        let rgb: number;
        if (id === SEA_ID) {
          const d = Math.min(40, dist[i]) / 40;
          const k = 1 - d;
          const r = 26 + 30 * k + n * 8, g = 56 + 50 * k + n * 10, b = 86 + 50 * k + n * 10;
          rgb = (r << 16) | (g << 8) | b;
          if (dist[i] === 1) rgb = 0x6f9cb0;
        } else if (id === WASTE_ID) {
          rgb = shade(0xcdb788, 0.9 + n * 0.2);
        } else if (id < P) {
          rgb = shade(TERRAIN_RGB[terrain[id]], 0.82 + n * 0.3);
        } else {
          rgb = shade(0xa99d76, 0.9 + n * 0.2);
        }
        px[i] = abgr(rgb);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** For each land pixel on a border: the neighbouring id, or -1. */
  private buildBorders(): void {
    const { width: W, height: H, ids } = this.map;
    const nb = new Int32Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const id = ids[i];
        if (id >= this.map.provinceCount) continue;
        if (x < W - 1 && ids[i + 1] !== id) nb[i] = ids[i + 1];
        else if (y < H - 1 && ids[i + W] !== id) nb[i] = ids[i + W];
        else if (x > 0 && ids[i - 1] !== id) nb[i] = ids[i - 1];
        else if (y > 0 && ids[i - W] !== id) nb[i] = ids[i - W];
      }
    }
    this.borderNb = nb;
  }

  /** Recolor the political layer from a per-province palette (no polygons involved). */
  recolor(pal: Palette, selected: number, highlight?: Uint8Array): void {
    const { width: W, height: H, ids, provinceCount: P } = this.map;
    const px = this.pixels;
    const nb = this.borderNb;
    // Precompute packed colors per province.
    const fill = new Uint32Array(P), edge = new Uint32Array(P), stripe = new Uint32Array(P);
    for (let p = 0; p < P; p++) {
      let rgb = pal.color[p];
      if (p === selected) rgb = shade(rgb, 1.35);
      else if (highlight && highlight[p]) rgb = shade(rgb, 1.18);
      fill[p] = abgr(rgb, pal.alpha[p]);
      edge[p] = abgr(shade(rgb, 0.7), Math.min(255, pal.alpha[p] + 40));
      stripe[p] = pal.stripe[p] >= 0 ? abgr(pal.stripe[p], 230) : 0;
    }
    const heavy = abgr(0x1a140e, 235);
    const coast = abgr(0x2a2018, 200);
    const sel = abgr(0xfff1c4, 255);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const id = ids[i];
        if (id >= P) {
          px[i] = 0;
          continue;
        }
        let c = fill[id];
        if (stripe[id] && ((x + y) & 7) < 3) c = stripe[id];
        const n = nb[i];
        if (n >= 0) {
          if (id === selected || n === selected) c = sel;
          else if (n >= P) c = n === SEA_ID ? coast : heavy;
          else if (pal.group[n] !== pal.group[id]) c = heavy;
          else c = edge[id];
        }
        px[i] = c;
      }
    }
    this.politicalCtx.putImageData(this.image, 0, 0);
    this.politicalTex.source.update();
    this.requestRender();
  }

  /** Realm name labels at the center of each realm's land. */
  setLabels(labels: { text: string; x: number; y: number; size: number }[]): void {
    for (const c of this.labels.removeChildren()) c.destroy();
    for (const l of labels) {
      const t = new Text({
        text: l.text.toUpperCase(),
        style: { fontFamily: 'Cinzel, Georgia, serif', fontSize: l.size, fill: 0xf3e6c4, stroke: { color: 0x1d140b, width: Math.max(2, l.size / 6) }, letterSpacing: l.size / 8, fontWeight: '700' },
        resolution: 2,
      });
      t.anchor.set(0.5);
      t.position.set(l.x, l.y);
      t.alpha = 0.85;
      this.labels.addChild(t);
    }
    this.requestRender();
  }

  /** Capital markers. */
  setCapitals(caps: { x: number; y: number; color: number; mine: boolean }[]): void {
    for (const c of this.markers.removeChildren()) c.destroy();
    const g = new Graphics();
    for (const c of caps) {
      g.rect(c.x - 2.5, c.y - 2.5, 5, 5).fill({ color: c.mine ? 0xffe08a : 0xf5ecd7 }).stroke({ color: 0x1a140e, width: 1 });
    }
    this.markers.addChild(g);
    this.requestRender();
  }

  setArmies(armies: ArmyInfo[], colorOf: (realm: number) => number, isMine: (realm: number) => boolean, selected: number): void {
    const seen = new Set<number>();
    const { anchorX, anchorY } = this.map;
    for (const a of armies) {
      seen.add(a.id);
      let s = this.armySprites.get(a.id);
      if (!s) {
        s = { g: new Graphics(), t: new Text({ text: '', style: { fontFamily: 'Inter, sans-serif', fontSize: 10, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, fontWeight: '700' }, resolution: 3 }) };
        s.t.anchor.set(0.5, 1.6);
        this.armyLayer.addChild(s.g, s.t);
        this.armySprites.set(a.id, s);
      }
      const x0 = anchorX[a.loc], y0 = anchorY[a.loc];
      const x = a.next >= 0 ? x0 + (anchorX[a.next] - x0) * a.progress : x0;
      const y = a.next >= 0 ? y0 + (anchorY[a.next] - y0) * a.progress : y0;
      const mine = isMine(a.realm);
      const g = s.g;
      g.clear();
      const col = colorOf(a.realm);
      const ring = a.id === selected ? 0xfff1c4 : mine ? 0xffd166 : 0x111111;
      if (a.kind === 0) {
        g.circle(0, 0, 7).fill({ color: col }).stroke({ color: ring, width: a.id === selected ? 3 : 2 });
        drawGlyph(g, a.main);
      }
      else if (a.kind === 1) g.poly([0, -7, 6, 0, 0, 7, -6, 0]).fill({ color: col }).stroke({ color: ring, width: 2 });
      else g.poly([0, -7, 7, 6, -7, 6]).fill({ color: 0x2b2b2b }).stroke({ color: 0xe5484d, width: 2 });
      if (a.sieging) g.circle(0, 0, 9).stroke({ color: 0xe5484d, width: 1.5, alpha: 0.9 });
      g.position.set(x, y);
      s.t.text = a.men >= 1000 ? `${(a.men / 1000).toFixed(1)}k` : `${a.men}`;
      s.t.position.set(x, y);
      const k = 1 / this.zoom ** 0.6;
      g.scale.set(k);
      s.t.scale.set(k);
    }
    for (const [id, s] of this.armySprites) {
      if (seen.has(id)) continue;
      s.g.destroy();
      s.t.destroy();
      this.armySprites.delete(id);
    }
    this.requestRender();
  }

  /** Marching route of the selected army: from its position through each province anchor. */
  setRoute(from: { x: number; y: number } | null, route: number[]): void {
    const g = this.route;
    g.clear();
    if (from && route.length) {
      const { anchorX, anchorY } = this.map;
      const w = 2.2 / this.zoom ** 0.5;
      g.moveTo(from.x, from.y);
      for (const p of route) g.lineTo(anchorX[p], anchorY[p]);
      g.stroke({ color: 0xfff1c4, width: w, alpha: 0.9 });
      const last = route[route.length - 1];
      g.circle(anchorX[last], anchorY[last], 5 / this.zoom ** 0.5).stroke({ color: 0xfff1c4, width: w });
    }
    this.requestRender();
  }

  /** Screen position of an army marker, if drawn. */
  armyPos(id: number): { x: number; y: number } | null {
    const s = this.armySprites.get(id);
    return s ? { x: s.g.x, y: s.g.y } : null;
  }

  /** Army under a screen point, or -1. */
  armyAt(sx: number, sy: number, armies: ArmyInfo[]): number {
    const [wx, wy] = this.toWorld(sx, sy);
    const r = 9 / this.zoom ** 0.6;
    for (const a of armies) {
      const s = this.armySprites.get(a.id);
      if (s && Math.hypot(s.g.x - wx, s.g.y - wy) < r) return a.id;
    }
    return -1;
  }

  provinceAt(sx: number, sy: number): number {
    const [wx, wy] = this.toWorld(sx, sy);
    const x = Math.floor(wx), y = Math.floor(wy);
    const { width: W, height: H, ids, provinceCount: P } = this.map;
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    const id = ids[y * W + x];
    return id < P ? id : -1;
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.world.x) / this.world.scale.x, (sy - this.world.y) / this.world.scale.y];
  }

  fit(): void {
    const { width: W, height: H } = this.map;
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const z = Math.min(sw / W, sh / H);
    this.minZoom = z * 0.8;
    this.setZoom(z, sw / 2, sh / 2, W / 2, H / 2);
  }

  centerOn(p: number): void {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const z = Math.max(this.zoom, 1.6);
    this.setZoom(z, sw / 2, sh / 2, this.map.anchorX[p], this.map.anchorY[p]);
  }

  private setZoom(z: number, sx: number, sy: number, wx: number, wy: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(8, z));
    this.world.scale.set(this.zoom);
    this.world.position.set(sx - wx * this.zoom, sy - wy * this.zoom);
    for (const s of this.armySprites.values()) {
      const k = 1 / this.zoom ** 0.6;
      s.g.scale.set(k);
      s.t.scale.set(k);
    }
    this.labels.visible = this.zoom < 3;
    this.requestRender();
  }

  private bindInput(): void {
    const el = this.app.canvas;
    let down: { x: number; y: number; wx: number; wy: number; moved: boolean; button: number } | null = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      down = { x: e.offsetX, y: e.offsetY, wx: this.world.x, wy: this.world.y, moved: false, button: e.button };
    });
    el.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
        if (down.moved && down.button === 0) {
          this.world.position.set(down.wx + dx, down.wy + dy);
          this.requestRender();
        }
      }
      const p = this.provinceAt(e.offsetX, e.offsetY);
      if (p !== this.hoverProv || p >= 0) {
        this.hoverProv = p;
        this.cb.onHover(p, e.clientX, e.clientY);
      }
    });
    el.addEventListener('pointerleave', () => {
      this.hoverProv = -1;
      this.cb.onHover(-1, 0, 0);
    });
    el.addEventListener('pointerup', (e) => {
      if (down && !down.moved) this.cb.onClick(this.provinceAt(e.offsetX, e.offsetY), down.button);
      down = null;
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY, wx, wy);
      },
      { passive: false },
    );
  }

  /** Render on demand: at most one frame per animation frame, and only when asked. */
  requestRender(): void {
    if (this.renderQueued || this.destroyed) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.destroyed) return;
      const t0 = performance.now();
      this.app.render();
      this.cb.onFrame(performance.now() - t0);
    });
  }
}

/** Small white symbol for the army's main troop type: spear, bow, sling, heavy, chariot. */
function drawGlyph(g: Graphics, main: number): void {
  const c = { color: 0xfdf6e3, width: 1.6 };
  switch (main) {
    case 0:
      g.moveTo(-3, 4).lineTo(3, -4).stroke(c);
      g.poly([3, -4, 1, -3.4, 2.4, -1.8]).fill({ color: 0xfdf6e3 });
      break;
    case 1:
      g.arc(0, 0, 4, -Math.PI / 2, Math.PI / 2).stroke(c);
      g.moveTo(0, -4).lineTo(0, 4).stroke({ color: 0xfdf6e3, width: 0.8 });
      break;
    case 2:
      g.circle(0, 0, 2).fill({ color: 0xfdf6e3 });
      break;
    case 3:
      g.poly([-3.5, -3.5, 3.5, -3.5, 3.5, 0.5, 0, 4, -3.5, 0.5]).fill({ color: 0xfdf6e3 });
      break;
    case 4:
      g.circle(0, 0, 4).stroke(c);
      g.moveTo(-4, 0).lineTo(4, 0).moveTo(0, -4).lineTo(0, 4).stroke({ color: 0xfdf6e3, width: 1 });
      break;
  }
}
