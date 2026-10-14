/**
 * Interactive coach-mark tutorial: spotlights a UI element (or a point in the world),
 * explains it, and advances automatically once the player has done the thing.
 */
export interface Seg { ax: number; ay: number; bx: number; by: number }

export interface TutStep {
  title: string;
  body: string;
  /** element to spotlight, or a screen-space rect */
  target?: () => Element | DOMRect | null;
  /** step completes when this returns true */
  done?: () => boolean;
  /** show a Next button (for read-only steps) */
  next?: boolean;
  /** dashed guide members drawn in the world */
  guide?: () => Seg[];
  enter?: () => void;
  /** label for the final button */
  finish?: string;
}

export class Tutorial {
  active = false;
  i = 0;
  private card: HTMLDivElement;
  private ring: HTMLDivElement;
  private doneAt = 0;

  constructor(private steps: TutStep[], private onEnd: (completed: boolean) => void, private onAdvance: () => void) {
    this.card = document.createElement('div');
    this.card.className = 'tut-card hidden';
    this.ring = document.createElement('div');
    this.ring.className = 'tut-ring hidden';
    document.getElementById('app')!.append(this.ring, this.card);
  }

  get step(): TutStep | null {
    return this.active ? this.steps[this.i] : null;
  }

  start() {
    this.active = true;
    this.go(0);
  }

  stop(completed = false) {
    if (!this.active) return;
    this.active = false;
    this.card.classList.add('hidden');
    this.ring.classList.add('hidden');
    this.onEnd(completed);
  }

  private go(i: number) {
    this.i = i;
    this.doneAt = 0;
    const s = this.steps[i];
    s.enter?.();
    const last = i === this.steps.length - 1;
    const dots = this.steps.map((_, k) => `<i class="${k < i ? 'past' : k === i ? 'now' : ''}"></i>`).join('');
    this.card.innerHTML = `
      <div class="tut-top"><span class="tut-step">Step ${i + 1} of ${this.steps.length}</span><button class="tut-x" title="Exit tutorial">✕</button></div>
      <h3>${s.title}</h3>
      <div class="tut-body">${s.body}</div>
      <div class="tut-foot"><div class="tut-dots">${dots}</div>
        ${i > 0 ? '<button class="tut-btn ghost" data-t="back">Back</button>' : ''}
        ${s.next || last ? `<button class="tut-btn" data-t="next">${last ? s.finish ?? 'Finish' : 'Next'}</button>` : '<span class="tut-wait">Waiting for you…</span>'}
      </div>`;
    this.card.querySelector('.tut-x')!.addEventListener('click', () => this.stop(false));
    this.card.querySelector('[data-t="next"]')?.addEventListener('click', () => (last ? this.stop(true) : this.go(i + 1)));
    this.card.querySelector('[data-t="back"]')?.addEventListener('click', () => this.go(i - 1));
    this.card.classList.remove('hidden', 'tut-ok');
    this.card.classList.add('tut-in');
    setTimeout(() => this.card.classList.remove('tut-in'), 300);
  }

  /** call every frame */
  tick(now: number) {
    if (!this.active) return;
    const s = this.steps[this.i];
    // completion
    if (s.done && !s.next) {
      if (s.done()) {
        if (!this.doneAt) {
          this.doneAt = now;
          this.card.classList.add('tut-ok');
          const wait = this.card.querySelector('.tut-wait');
          if (wait) wait.textContent = '✓ Nice!';
          this.onAdvance();
        } else if (now - this.doneAt > 900) {
          this.i + 1 < this.steps.length ? this.go(this.i + 1) : this.stop(true);
          return;
        }
      } else if (this.doneAt) {
        this.doneAt = 0;
        this.card.classList.remove('tut-ok');
        const wait = this.card.querySelector('.tut-wait');
        if (wait) wait.textContent = 'Waiting for you…';
      }
    }
    // spotlight
    const t = s.target?.() ?? null;
    let rect: DOMRect | null = null;
    if (t instanceof DOMRect) rect = t;
    else if (t) rect = (t as Element).getBoundingClientRect();
    if (rect && rect.width > 0) {
      const pad = 6;
      Object.assign(this.ring.style, {
        left: rect.left - pad + 'px', top: rect.top - pad + 'px',
        width: rect.width + pad * 2 + 'px', height: rect.height + pad * 2 + 'px',
      });
      this.ring.classList.remove('hidden');
    } else this.ring.classList.add('hidden');
    this.place(rect);
  }

  private place(rect: DOMRect | null) {
    const W = window.innerWidth, H = window.innerHeight;
    const cw = this.card.offsetWidth || 360, ch = this.card.offsetHeight || 200;
    let x: number, y: number;
    if (!rect) {
      x = (W - cw) / 2;
      y = H - ch - 90;
    } else {
      const gap = 16;
      const right = W - rect.right, left = rect.left, below = H - rect.bottom, above = rect.top;
      if (right >= cw + gap * 2 && right >= left) { x = rect.right + gap; y = rect.top + rect.height / 2 - ch / 2; }
      else if (left >= cw + gap * 2) { x = rect.left - gap - cw; y = rect.top + rect.height / 2 - ch / 2; }
      else if (below >= ch + gap) { x = rect.left + rect.width / 2 - cw / 2; y = rect.bottom + gap; }
      else if (above >= ch + gap) { x = rect.left + rect.width / 2 - cw / 2; y = rect.top - gap - ch; }
      else { x = (W - cw) / 2; y = H - ch - 90; }
    }
    x = Math.max(12, Math.min(W - cw - 12, x));
    y = Math.max(70, Math.min(H - ch - 12, y));
    this.card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  guide(): Seg[] {
    return this.step?.guide?.() ?? [];
  }
}
