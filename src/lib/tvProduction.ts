export type TvSceneId = 'camera' | 'video' | 'screen' | 'guest' | 'replay' | 'black';

export type TransitionType = 'cut' | 'fade' | 'dip';

export interface TvTransition {
  type: TransitionType;
  durationMs: number;
}

export interface TvGraphic {
  id: string;
  kind: 'lower-third' | 'bug' | 'ticker' | 'banner' | 'fullscreen';
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
  push(canvas: HTMLCanvasElement) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    const now = performance.now();
    this.frames.push({ timestamp: now, canvas: copy });
    const cutoff = now - this.maxDurationMs;
    while (this.frames.length && this.frames[0].timestamp < cutoff) this.frames.shift();
  }
  latestCanvas(): HTMLCanvasElement | null { return this.frames[this.frames.length - 1]?.canvas ?? null; }
  clear() { this.frames = []; }
  get durationMs() {
    if (this.frames.length < 2) return 0;
    return this.frames[this.frames.length - 1].timestamp - this.frames[0].timestamp;
  }
  get frameCount() { return this.frames.length; }
}

export function drawTvGraphics(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graphics: TvGraphic[],
  tickerOffset: number,
) {
  const ordered = [...graphics].filter(g => g.visible).sort((a, b) => a.z - b.z);
  for (const g of ordered) {
    if (g.kind === 'bug') {
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      ctx.beginPath();
      ctx.roundRect(width - 190, 24, 160, 48, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.text.slice(0, 18), width - 110, 55);
      ctx.restore();
    } else if (g.kind === 'lower-third') {
      const y = height - 150;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.82)';
      ctx.fillRect(36, y, Math.min(width - 72, g.width ?? 760), 92);
      ctx.fillStyle = '#fff';
      ctx.font = '700 30px sans-serif';
      ctx.fillText(g.text.slice(0, 54), 60, y + 38);
      if (g.secondary) {
        ctx.font = '500 20px sans-serif';
        ctx.fillText(g.secondary.slice(0, 72), 60, y + 70);
      }
      ctx.restore();
    } else if (g.kind === 'ticker' || g.kind === 'banner') {
      const y = height - 56;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.88)';
      ctx.fillRect(0, y, width, 56);
      ctx.fillStyle = '#fff';
      ctx.font = '600 22px sans-serif';
      const text = g.text || '';
      const x = width - (tickerOffset % Math.max(width + ctx.measureText(text).width, 1));
      ctx.fillText(text, x, y + 36);
      ctx.restore();
    } else if (g.kind === 'fullscreen') {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.88)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff';
      ctx.font = '700 54px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.text.slice(0, 42), width / 2, height / 2);
      ctx.restore();
    }
  }
}

export function makeDefaultGraphics(): TvGraphic[] {
  return [
    { id: 'station-bug', kind: 'bug', text: 'TESTAGRAM TV', visible: true, z: 100 },
    { id: 'lower-third', kind: 'lower-third', text: '', secondary: '', visible: false, z: 110 },
    { id: 'ticker', kind: 'ticker', text: '', visible: false, z: 120 },
  ];
}
