export type TvSceneId = 'camera' | 'video' | 'screen' | 'guest' | 'replay' | 'black';

export type TransitionType = 'cut' | 'fade' | 'dip';

export interface TvTransition {
  type: TransitionType;
  durationMs: number;
}

export interface TvGraphic {
  id: string;
  kind: 'lower-third' | 'bug' | 'ticker' | 'banner' | 'fullscreen' | 'next';
  text: string;
  secondary?: string;
  visible: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z: number;
}

export interface TvAudioBusState {
  microphone: number;
  program: number;
  guest: number;
  music: number;
  effects: number;
  master: number;
  ducking: boolean;
}

export interface TvReplayFrame {
  timestamp: number;
  canvas: HTMLCanvasElement;
}

export class TvReplayBuffer {
  private frames: TvReplayFrame[] = [];
  constructor(private readonly maxDurationMs = 30000, private readonly intervalMs = 500) {}
  push(canvas: HTMLCanvasElement, now = performance.now()) {
    const copy = document.createElement('canvas');
    const maxWidth = 640;
    const maxHeight = 360;
    const scale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height);
    copy.width = Math.max(1, Math.round(canvas.width * scale));
    copy.height = Math.max(1, Math.round(canvas.height * scale));
    copy.getContext('2d')?.drawImage(canvas, 0, 0, copy.width, copy.height);
    this.frames.push({ timestamp: now, canvas: copy });
    const cutoff = now - this.maxDurationMs;
    while (this.frames.length && this.frames[0].timestamp < cutoff) this.frames.shift();
  }
  shouldCapture(now = performance.now()) {
    const last = this.frames[this.frames.length - 1];
    return !last || now - last.timestamp >= this.intervalMs;
  }
  getFrames() { return this.frames.slice(); }
  latestCanvas() { return this.frames[this.frames.length - 1]?.canvas ?? null; }
  clear() { this.frames = []; }
  get durationMs() { return this.frames.length < 2 ? 0 : this.frames[this.frames.length - 1].timestamp - this.frames[0].timestamp; }
  get frameCount() { return this.frames.length; }
}

export function drawTvGraphics(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graphics: TvGraphic[],
  tickerOffset: number,
  options: { live?: boolean; watermark?: boolean } = {},
) {
  const live = options.live ?? false;
  const watermark = options.watermark ?? true;
  const safeX = Math.max(28, Math.round(width * 0.055));
  const safeY = Math.max(22, Math.round(height * 0.055));
  const safeW = width - safeX * 2;
  const safeBottom = height - Math.max(26, Math.round(height * 0.055));
  const clampText = (value: string, max: number) => value.trim().slice(0, max);
  const rounded = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };

  const drawBrandBug = () => {
    const bugW = Math.min(270, Math.max(190, width * 0.145));
    const bugH = Math.min(62, Math.max(48, height * 0.055));
    const x = width - safeX - bugW;
    const y = safeY;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(9,9,11,.90)';
    rounded(x, y, bugW, bugH, 14); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x, y, 6, bugH);
    ctx.fillStyle = '#fafafa';
    ctx.font = '800 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TESTAGRAM TV', x + 18, y + 24);
    if (live) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(x + 24, y + 43, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f4f5';
      ctx.font = '700 12px sans-serif';
      ctx.fillText('LIVE', x + 34, y + 47);
    } else {
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '600 11px sans-serif';
      ctx.fillText('BROADCAST', x + 18, y + 47);
    }
    ctx.restore();
  };

  const drawWatermark = () => {
    if (!watermark) return;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#fafafa';
    ctx.font = '800 18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('TESTAGRAM TV', width - safeX, safeBottom - 4);
    ctx.restore();
  };

  drawBrandBug();
  drawWatermark();

  const ordered = [...graphics].filter(g => g.visible && g.id !== 'station-bug').sort((a, b) => a.z - b.z);
  for (const g of ordered) {
    if (g.kind === 'bug') {
      // The station bug is rendered by the broadcast branding layer above.
      continue;
    } else if (g.kind === 'lower-third') {
      if (!g.text.trim() && !g.secondary?.trim()) continue;
      const maxW = Math.min(safeW, Math.max(560, width * 0.56));
      const x = safeX;
      const h = 112;
      const y = safeBottom - h - (g.y ?? 0);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(9,9,11,.94)';
      rounded(x, y, Math.min(maxW, g.width ?? maxW), h, 10); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444'; ctx.fillRect(x, y, 7, h);
      ctx.fillStyle = '#a1a1aa'; ctx.font = '800 11px sans-serif';
      ctx.fillText('TESTAGRAM TV', x + 24, y + 24);
      ctx.fillStyle = '#fafafa'; ctx.font = '800 29px sans-serif';
      ctx.fillText(clampText(g.text, 54), x + 24, y + 59);
      if (g.secondary?.trim()) {
        ctx.fillStyle = '#d4d4d8'; ctx.font = '500 18px sans-serif';
        ctx.fillText(clampText(g.secondary, 76), x + 24, y + 88);
      }
      ctx.restore();
    } else if (g.kind === 'ticker') {
      const y = safeBottom - 48;
      const h = 48;
      ctx.save();
      ctx.fillStyle = 'rgba(9,9,11,.94)'; ctx.fillRect(0, y, width, h);
      ctx.fillStyle = '#ef4444'; ctx.fillRect(0, y, Math.min(width, 150), h);
      ctx.fillStyle = '#fff'; ctx.font = '800 15px sans-serif'; ctx.fillText('TESTAGRAM TV', safeX - 4, y + 31);
      ctx.beginPath(); ctx.rect(150, y, width - 150, h); ctx.clip();
      const text = clampText(g.text, 180) || 'Stay with Testagram TV';
      ctx.fillStyle = '#f4f4f5'; ctx.font = '600 19px sans-serif';
      const measured = ctx.measureText(text).width;
      const cycle = Math.max(width + measured + 96, 1);
      ctx.fillText(text, width - (tickerOffset % cycle), y + 31);
      ctx.restore();
    } else if (g.kind === 'banner') {
      const y = safeBottom - 76;
      ctx.save();
      ctx.fillStyle = 'rgba(9,9,11,.96)'; ctx.fillRect(safeX, y, safeW, 58);
      ctx.fillStyle = '#ef4444'; ctx.fillRect(safeX, y, 210, 58);
      ctx.fillStyle = '#fff'; ctx.font = '900 17px sans-serif'; ctx.fillText('BREAKING NEWS', safeX + 20, y + 36);
      ctx.fillStyle = '#fafafa'; ctx.font = '700 20px sans-serif';
      ctx.fillText(clampText(g.text, 100), safeX + 230, y + 36);
      ctx.restore();
    } else if (g.kind === 'next') {
      const w = Math.min(430, safeW * 0.42);
      const h = 66;
      const x = width - safeX - w;
      const y = safeBottom - h;
      ctx.save();
      ctx.fillStyle = 'rgba(9,9,11,.94)'; rounded(x, y, w, h, 10); ctx.fill();
      ctx.fillStyle = '#ef4444'; ctx.fillRect(x, y, 6, h);
      ctx.fillStyle = '#a1a1aa'; ctx.font = '800 11px sans-serif'; ctx.fillText('NEXT ON TESTAGRAM TV', x + 20, y + 22);
      ctx.fillStyle = '#fafafa'; ctx.font = '700 17px sans-serif'; ctx.fillText(clampText(g.text, 48), x + 20, y + 47);
      ctx.restore();
    } else if (g.kind === 'fullscreen') {
      ctx.save();
      ctx.fillStyle = 'rgba(9,9,11,.94)'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, width, 8);
      ctx.fillStyle = '#fafafa'; ctx.font = '900 24px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('TESTAGRAM TV', width / 2, height * 0.32);
      ctx.font = '800 54px sans-serif';
      ctx.fillText(clampText(g.text, 54), width / 2, height / 2);
      if (g.secondary?.trim()) {
        ctx.fillStyle = '#a1a1aa'; ctx.font = '500 22px sans-serif';
        ctx.fillText(clampText(g.secondary, 80), width / 2, height / 2 + 42);
      }
      ctx.restore();
    }
  }
}

export function drawTvOpeningSlate(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  subtitle = 'LIVE TELEVISION FROM TESTAGRAM',
) {
  const p = Math.max(0, Math.min(1, progress));
  const fade = Math.min(1, p * 5, (1 - p) * 5);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.fillStyle = '#09090b'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, width, Math.max(6, height * 0.008));
  ctx.fillStyle = '#fafafa'; ctx.font = '900 64px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('TESTAGRAM TV', width / 2, height * 0.48);
  ctx.fillStyle = '#a1a1aa'; ctx.font = '700 20px sans-serif';
  ctx.fillText(subtitle, width / 2, height * 0.56);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(width * 0.42, height * 0.63, width * 0.16, 4);
  ctx.restore();
}

export function makeDefaultGraphics(): TvGraphic[] {
  return [
    { id: 'station-bug', kind: 'bug', text: 'TESTAGRAM TV', visible: true, z: 100 },
    { id: 'lower-third', kind: 'lower-third', text: '', secondary: '', visible: false, z: 110 },
    { id: 'ticker', kind: 'ticker', text: '', visible: false, z: 120 },
    { id: 'breaking-banner', kind: 'banner', text: '', visible: false, z: 130 },
    { id: 'next', kind: 'next', text: '', visible: false, z: 140 },
    { id: 'fullscreen', kind: 'fullscreen', text: '', visible: false, z: 200 },
  ];
}
