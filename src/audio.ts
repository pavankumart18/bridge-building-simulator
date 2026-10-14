/** Tiny synthesized sound kit — no asset files. */
import type { MaterialId } from './materials';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastBreak = 0;
  muted = false;

  private ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.muted ? null : this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, delay = 0, slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, filter: BiquadFilterType, freq: number, q: number, vol: number, sweepTo?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  unlock() { this.ensure(); }
  place() { this.tone(880, 0.06, 'triangle', 0.12); this.tone(1320, 0.05, 'sine', 0.06, 0.02); }
  remove() { this.tone(300, 0.1, 'triangle', 0.14, 0, 160); }
  click() { this.tone(660, 0.04, 'sine', 0.08); }
  error() { this.tone(180, 0.12, 'square', 0.05); }

  snap(mat: MaterialId | null | undefined) {
    const now = performance.now();
    if (now - this.lastBreak < 45) return;
    this.lastBreak = now;
    if (mat === 'steel' || mat === 'cable') {
      this.noise(0.25, 'highpass', 2500, 0.7, 0.5);
      this.tone(mat === 'cable' ? 1900 : 1250, 0.6, 'triangle', 0.12, 0, mat === 'cable' ? 700 : 900);
    } else if (mat === 'deck') {
      this.noise(0.45, 'lowpass', 900, 0.8, 0.8, 120);
      this.tone(90, 0.3, 'sine', 0.25, 0, 45);
    } else {
      this.noise(0.18, 'bandpass', 1400, 1.4, 0.9);
      this.noise(0.35, 'lowpass', 600, 0.6, 0.35, 150);
    }
  }

  splash(big: boolean) { this.noise(big ? 0.9 : 0.35, 'lowpass', big ? 1800 : 2600, 0.6, big ? 0.6 : 0.15, 200); }

  success() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, i * 0.11)); }
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.06, i * 0.15)); }
  start() { this.tone(440, 0.08, 'triangle', 0.12); this.tone(660, 0.12, 'triangle', 0.12, 0.08); }
}

export const audio = new Audio();
