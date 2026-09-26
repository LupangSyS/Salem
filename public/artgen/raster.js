/* Pixel rasterizer — วาดภาพลงบัฟเฟอร์ RGBA ทีละพิกเซล (ใช้ได้ทั้ง Node และเบราว์เซอร์)
   ทุกอย่างกำหนดผลได้แน่นอน (deterministic): ข้อมูลเดิม → พิกเซลเดิมทุกครั้ง */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArtRaster = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const cache = new Map();
  function rgb(c) {
    if (Array.isArray(c)) return c;
    let v = cache.get(c);
    if (!v) {
      const h = c.replace('#', '');
      v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      cache.set(c, v);
    }
    return v;
  }
  function mix(a, b, t) {
    const x = rgb(a); const y = rgb(b);
    return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  function shade(c, k) {
    const x = rgb(c);
    return k >= 0 ? mix(x, [255, 255, 255], k) : mix(x, [0, 0, 0], -k);
  }

  class Canvas {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.d = new Uint8ClampedArray(w * h * 4);
    }

    /** วางพิกเซลพร้อมผสมความโปร่งใส */
    px(x, y, c, a = 1) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return this;
      const col = rgb(c);
      const i = (y * this.w + x) * 4;
      const d = this.d;
      const al = Math.min(1, a);
      const da = d[i + 3] / 255;
      const oa = al + da * (1 - al);
      for (let k = 0; k < 3; k++) d[i + k] = oa ? (col[k] * al + d[i + k] * da * (1 - al)) / oa : 0;
      d[i + 3] = oa * 255;
      return this;
    }
    get(x, y) {
      const i = (y * this.w + x) * 4;
      return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
    }

    /** เติมทั้งภาพด้วยฟังก์ชันสีรายพิกเซล fn(x, y) → [r,g,b] */
    fill(fn) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const c = fn(x, y); if (c) this.px(x, y, c, c[3] === undefined ? 1 : c[3]); }
      return this;
    }
    rect(x, y, w, h, c, a = 1) {
      for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) this.px(i, j, c, a);
      return this;
    }
    ellipse(cx, cy, rx, ry, c, a = 1) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx; const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) this.px(x, y, c, a);
        }
      }
      return this;
    }
    circle(cx, cy, r, c, a = 1) { return this.ellipse(cx, cy, r, r, c, a); }
    /** รูปหลายเหลี่ยม (scanline, even-odd) */
    poly(pts, c, a = 1) {
      let minY = Infinity; let maxY = -Infinity;
      for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const sy = y + 0.5;
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [x0, y0] = pts[i]; const [x1, y1] = pts[(i + 1) % pts.length];
          if ((y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy)) xs.push(x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) this.px(x, y, c, a);
        }
      }
      return this;
    }
    /** เส้นหนา w พิกเซล (ปลายมน) */
    line(x0, y0, x1, y1, w, c, a = 1) {
      const dx = x1 - x0; const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (w / 2); const ny = (dx / len) * (w / 2);
      if (w <= 1.2) {
        const n = Math.ceil(len * 2);
        for (let i = 0; i <= n; i++) this.px(x0 + (dx * i) / n, y0 + (dy * i) / n, c, a);
        return this;
      }
      this.poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c, a);
      this.circle(x0, y0, w / 2, c, a);
      this.circle(x1, y1, w / 2, c, a);
      return this;
    }
    path(pts, w, c, a = 1) {
      for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c, a);
      return this;
    }
    /** ขอบเข้ม 1 พิกเซลรอบส่วนที่ทึบ (สไตล์ pixel art) */
    outline(c = '#140b07') {
      const out = new Canvas(this.w, this.h);
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.d[(y * this.w + x) * 4 + 3] > 40) continue;
          const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => {
            const X = x + i; const Y = y + j;
            return X >= 0 && Y >= 0 && X < this.w && Y < this.h && this.d[(Y * this.w + X) * 4 + 3] > 40;
          });
          if (n) out.px(x, y, c);
        }
      }
      out.draw(this);
      return out;
    }
    /** วางภาพอื่นทับ */
    draw(src, dx = 0, dy = 0) {
      for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) {
          const i = (y * src.w + x) * 4;
          const a = src.d[i + 3] / 255;
          if (a > 0) this.px(x + dx, y + dy, [src.d[i], src.d[i + 1], src.d[i + 2]], a);
        }
      }
      return this;
    }
    /** ตัดส่วนของภาพ */
    crop(x0, y0, w, h) {
      const out = new Canvas(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const s = ((y + y0) * this.w + (x + x0)) * 4;
          const t = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) out.d[t + c] = this.d[s + c];
        }
      }
      return out;
    }
    /** ขยายแบบ nearest-neighbor ให้พิกเซลคมชัด */
    scale(k) {
      const out = new Canvas(this.w * k, this.h * k);
      for (let y = 0; y < out.h; y++) {
        for (let x = 0; x < out.w; x++) {
          const s = ((Math.floor(y / k) * this.w) + Math.floor(x / k)) * 4;
          const t = (y * out.w + x) * 4;
          for (let c = 0; c < 4; c++) out.d[t + c] = this.d[s + c];
        }
      }
      return out;
    }
  }

  return { Canvas, hash, rng, rgb, mix, shade };
}));
