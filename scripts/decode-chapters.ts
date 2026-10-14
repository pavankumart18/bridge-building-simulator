/** Re-reads exact chapter times from the colour code in the corner of "Span Tutorial.mp4". */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const H = 900, FPS = 20;
const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'Span Tutorial.mp4', '-vf', `crop=4:4:2:${H - 6},scale=1:1,fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
const code = (f: number) => {
  const [r, g, b] = [raw[f * 3], raw[f * 3 + 1], raw[f * 3 + 2]];
  const k = Math.round(r / 17);
  return k >= 1 && Math.abs(r - k * 17) < 6 && Math.abs(g - (255 - k * 17)) < 8 && Math.abs(b - 200) < 20 ? k : 0;
};
// a chapter starts at the first frame of a run of ≥ 4 identical codes (filters compression noise)
const first = new Map<number, number>();
const n = Math.floor(raw.length / 3);
for (let f = 0; f + 3 < n; f++) {
  const k = code(f);
  if (k && !first.has(k) && code(f + 1) === k && code(f + 2) === k && code(f + 3) === k) first.set(k, f / FPS);
}
const ch = JSON.parse(readFileSync('src/video-chapters.json', 'utf8')) as { n: string; t: number }[];
for (const c of ch) { const t = first.get(Number(c.n)); if (t !== undefined) c.t = +(t + 0.2).toFixed(2); }
writeFileSync('src/video-chapters.json', JSON.stringify(ch, null, 2));
console.log(ch.map((c) => `${c.n}@${c.t}`).join(' '));
