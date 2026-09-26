/* สูตรวาดภาพประกอบทุกใบของ เซเลม 1692 — pixel art สร้างจากโค้ดล้วน (ไม่ใช้ AI ไม่ใช้ภาพจากเกมจริง)
   ภาพผลลัพธ์ถูกบันทึกถาวรที่ public/art/ ด้วย scripts/build-art.js */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./raster'));
  else root.ArtDesigns = factory(root.ArtRaster);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const { Canvas, hash, rng, mix, shade } = R;
  const VERSION = 1;
  const INK = '#140b07';
  const W = 66; const H = 54;

  // ขนาดพิกเซลจริง (logical) และตัวคูณขยายตอนบันทึกเป็นไฟล์
  const SPECS = {
    cards: { w: W, h: H, scale: 3 },
    tryal: { w: W, h: H, scale: 3 },
    chars: { w: W, h: H, scale: 3 },
    back: { w: 66, h: 94, scale: 3 },
    tryalback: { w: 44, h: 62, scale: 3 },
    cat: { w: 24, h: 24, scale: 4 },
    table: { w: 160, h: 110, scale: 4 },
  };

  // ───────────────────────── helpers ─────────────────────────
  function background(seed, top, bottom, glow, w = W, h = H, gy = 0.42) {
    const r = rng(seed);
    return new Canvas(w, h).fill((x, y) => {
      let c = mix(top, bottom, y / (h - 1));
      const dx = (x - w / 2) / w; const dy = (y - h * gy) / h;
      const g = Math.max(0, 1 - Math.hypot(dx, dy) * 2.3);
      c = mix(c, glow, g * g * 0.75);
      const v = Math.max(0, Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) - 0.8) * 110;
      const n = (r() - 0.5) * 12;
      return [c[0] + n - v, c[1] + n - v, c[2] + n - v];
    });
  }
  function compose(bg, draw) { const L = new Canvas(bg.w, bg.h); draw(L); return bg.draw(L.outline(INK)); }
  function frame(L, w, h, c, inset = 3) {
    L.rect(inset, inset, w - inset * 2, 1, c); L.rect(inset, h - inset - 1, w - inset * 2, 1, c);
    L.rect(inset, inset, 1, h - inset * 2, c); L.rect(w - inset - 1, inset, 1, h - inset * 2, c);
  }
  function stars(L, seed, n, box, c = '#fff8c8') {
    const r = rng(seed);
    for (let i = 0; i < n; i++) L.px(box[0] + r() * box[2], box[1] + r() * box[3], c);
  }
  function houses(L, y0, c1, c2, win) {
    L.poly([[2, H], [2, y0 + 8], [11, y0], [20, y0 + 8], [20, H]], c1);
    L.poly([[22, H], [22, y0 + 4], [33, y0 - 6], [44, y0 + 4], [44, H]], c2);
    L.poly([[46, H], [46, y0 + 9], [55, y0 + 1], [64, y0 + 9], [64, H]], c1);
    if (win) { L.rect(31, y0 + 8, 4, 5, win); L.rect(8, y0 + 12, 3, 4, win); }
  }
  function cat(L, x, y, s = 1, c = '#0a060a', eye = '#ffd040') {
    L.ellipse(x, y + 8 * s, 8 * s, 6 * s, c);
    L.circle(x - 1 * s, y, 4.5 * s, c);
    L.poly([[x - 5 * s, y - 2 * s], [x - 5 * s, y - 7 * s], [x - 2 * s, y - 3 * s]], c);
    L.poly([[x, y - 3 * s], [x + 3 * s, y - 7 * s], [x + 3 * s, y - 2 * s]], c);
    L.path([[x + 7 * s, y + 11 * s], [x + 12 * s, y + 7 * s], [x + 11 * s, y]], Math.max(1, 1.6 * s), c);
    L.px(x - 3 * s, y, eye).px(x + 1 * s, y, eye);
  }
  function hood(L, x, y, c) {
    L.poly([[x - 9, H], [x - 7, y + 6], [x - 5, y - 2], [x, y - 7], [x + 5, y - 2], [x + 7, y + 6], [x + 9, H]], c);
    L.ellipse(x, y + 1, 3.5, 4, '#0a0608');
    L.px(x - 1, y + 1, '#e04030').px(x + 1, y + 1, '#e04030');
  }

  // ───────────────────────── playing cards ─────────────────────────
  const CARD = {};
  const card = (key, bg, draw) => { CARD[key] = { bg, draw }; };
  const RED = ['#c8483a', '#2a0808', '#ffb080'];
  const GREEN = ['#4f9a3a', '#0a2008', '#d8f0a0'];
  const BLUE = ['#3f6fa8', '#081428', '#c0e0ff'];

  card('accusation', RED, (L) => {
    L.rect(0, 30, 30, 10, '#3a2a40');
    L.rect(26, 29, 5, 12, '#f2eee4');
    L.ellipse(36, 35, 7, 6, '#e8b890');
    L.rect(40, 31, 18, 4, '#e8b890');
    L.rect(34, 39, 6, 3, '#d8a880');
    L.px(56, 32, '#f0d0b0').px(57, 32, '#f0d0b0');
  });
  card('evidence', ['#b84a38', '#240a08', '#ffc890'], (L) => {
    L.poly([[12, 14], [52, 12], [54, 44], [14, 46]], '#e8dcb0');
    for (let y = 20; y < 40; y += 4) L.line(18, y, 46, y - 1, 1, '#8a7a5a');
    L.circle(44, 40, 6, '#a01818'); L.circle(44, 40, 3, '#d04030');
    L.line(28, 46, 28, 53, 2, '#a01818'); L.line(31, 46, 33, 53, 2, '#a01818');
  });
  card('witness', ['#d0503a', '#300808', '#ffe0a0'], (L) => {
    L.ellipse(33, 27, 22, 12, '#f4eee0');
    L.circle(33, 27, 9, '#5a8ab8'); L.circle(33, 27, 5, '#141018');
    L.px(30, 24, '#ffffff').px(31, 24, '#ffffff').px(30, 25, '#ffffff');
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      L.line(33 + Math.cos(a) * 24, 27 + Math.sin(a) * 15, 33 + Math.cos(a) * 29, 27 + Math.sin(a) * 19, 1, '#ffd070');
    }
  });
  card('alibi', GREEN, (L) => {
    L.rect(21, 10, 24, 3, '#7a5a30'); L.rect(21, 42, 24, 3, '#7a5a30');
    L.poly([[23, 13], [43, 13], [34, 27], [32, 27]], '#cfe8f0');
    L.poly([[32, 29], [34, 29], [43, 42], [23, 42]], '#cfe8f0');
    L.poly([[27, 37], [39, 37], [42, 42], [24, 42]], '#e8c070');
    L.line(33, 25, 33, 37, 1, '#e8c070');
  });
  card('stocks', ['#5a8a3a', '#0c1c08', '#e0e8a0'], (L) => {
    L.rect(30, 28, 6, 26, '#6a4a28');
    L.rect(8, 20, 50, 10, '#8a6038');
    L.line(8, 25, 58, 25, 1, '#4a3018');
    for (const x of [16, 33, 50]) L.circle(x, 25, x === 33 ? 4 : 3, '#1a1008');
    L.rect(4, 50, 58, 4, '#3a5a20');
  });
  card('scapegoat', ['#6a9a3a', '#10200a', '#f0f0b0'], (L) => {
    const f = '#ece6d6';
    L.ellipse(36, 32, 15, 8, f);
    L.circle(18, 24, 6, f);
    L.poly([[13, 26], [8, 32], [15, 30]], f);
    L.path([[16, 19], [12, 12], [8, 13]], 2, '#8a7a5a');
    L.path([[20, 19], [22, 12], [26, 12]], 2, '#8a7a5a');
    for (const x of [26, 30, 42, 46]) L.line(x, 38, x, 48, 2, f);
    L.path([[50, 29], [54, 25]], 2, f);
    L.px(16, 23, INK);
    L.rect(30, 26, 12, 3, '#b8402e');
  });
  card('robbery', ['#3a7a4a', '#081a10', '#b8e8c0'], (L) => {
    L.ellipse(33, 36, 14, 12, '#a07848');
    L.poly([[26, 24], [40, 24], [37, 18], [29, 18]], '#a07848');
    L.rect(26, 24, 14, 2, '#5a3a18');
    L.circle(33, 38, 4, '#e8c070'); L.rect(32, 35, 2, 6, '#a07848');
    L.ellipse(14, 20, 7, 5, '#1a1a22');
    L.rect(4, 18, 8, 5, '#1a1a22');
    L.px(12, 19, '#f0f0f0').px(16, 19, '#f0f0f0');
    L.circle(52, 46, 3, '#e8c070'); L.circle(46, 49, 2.5, '#e8c070');
  });
  card('arson', ['#8a6a20', '#1a0a04', '#ffd060'], (L) => {
    L.poly([[14, 54], [14, 34], [33, 20], [52, 34], [52, 54]], '#5a3a22');
    L.rect(28, 42, 10, 12, '#2a1810');
    L.poly([[18, 34], [22, 14], [26, 26], [31, 6], [36, 24], [41, 12], [46, 34]], '#e85020');
    L.poly([[24, 34], [27, 22], [31, 28], [35, 16], [39, 28], [42, 34]], '#ffc040');
  });
  card('curse', ['#5a7a3a', '#10081a', '#c890e8'], (L) => {
    for (let i = 0; i < 4; i++) L.ellipse(20 + i * 9, 40 - i * 6, 9, 6, '#6a3a8a', 0.8);
    L.circle(33, 22, 10, '#e8e2d0');
    L.rect(27, 30, 12, 6, '#e8e2d0');
    L.circle(29, 22, 3, '#2a1030'); L.circle(37, 22, 3, '#2a1030');
    L.px(33, 27, '#2a1030');
    for (const x of [29, 32, 35]) L.rect(x, 33, 1, 3, '#2a1030');
  });
  card('asylum', BLUE, (L) => {
    L.poly([[12, 50], [12, 26], [33, 10], [54, 26], [54, 50]], '#e8e0c8');
    L.poly([[8, 28], [33, 8], [58, 28], [54, 30], [33, 14], [12, 30]], '#6a3a28');
    L.rect(28, 36, 10, 14, '#5a3a20');
    L.rect(16, 32, 7, 7, '#ffd070'); L.rect(43, 32, 7, 7, '#ffd070');
    L.line(19.5, 32, 19.5, 39, 1, '#6a4a20'); L.line(46.5, 32, 46.5, 39, 1, '#6a4a20');
    for (let x = 2; x < 64; x += 5) L.rect(x, 46, 2, 8, '#d8d0b8');
  });
  card('piety', BLUE, (L) => {
    L.poly([[20, 46], [33, 8], [46, 46]], '#e8e0c8');
    L.rect(22, 30, 22, 16, '#d8d0b8');
    L.rect(31, 12, 4, 14, '#e8c070'); L.rect(27, 16, 12, 3, '#e8c070');
    L.rect(29, 36, 8, 10, '#5a3a20');
    L.rect(6, 46, 54, 8, '#2a4a70');
  });
  card('matchmaker', ['#5a70b8', '#0c1030', '#f0c0e0'], (L) => {
    L.circle(25, 28, 11, '#e8c070'); L.circle(25, 28, 7, '#3a4a88');
    L.circle(41, 28, 11, '#e8c070'); L.circle(41, 28, 7, '#3a4a88');
    L.circle(25, 17, 3, '#c8f0ff');
    L.poly([[33, 44], [27, 38], [27, 35], [30, 34], [33, 37], [36, 34], [39, 35], [39, 38]], '#e04060');
  });
  card('night', ['#1a1838', '#04040c', '#5a5aa0'], (L) => {
    L.circle(46, 14, 8, '#f0e8b0'); L.circle(50, 11, 7, '#1c1a3c');
    stars(L, 7, 9, [2, 2, 40, 22]);
    houses(L, 32, '#0c0a14', '#100c18', '#ffcc40');
  });
  card('conspiracy', ['#3a2848', '#08040c', '#a060c0'], (L) => {
    hood(L, 14, 26, '#2a1a30');
    hood(L, 52, 26, '#2a1a30');
    cat(L, 33, 28, 1.3);
  });

  // ───────────────────────── tryal cards ─────────────────────────
  const TRYAL = {
    nw: { bg: ['#6a8a5a', '#0e1a0a', '#f0f8d8'], draw: (L) => {
      L.ellipse(33, 30, 12, 8, '#f4f4ee');
      L.circle(44, 24, 5, '#f4f4ee');
      L.poly([[48, 24], [54, 25], [48, 27]], '#e8b040');
      L.px(45, 23, INK);
      L.poly([[26, 28], [14, 14], [36, 26]], '#e8e8e0');
      L.poly([[22, 32], [10, 38], [24, 36]], '#e8e8e0');
      L.path([[36, 38], [34, 46], [30, 48]], 1, '#4a8a3a');
      L.ellipse(28, 48, 3, 1.5, '#4a8a3a');
    } },
    w: { bg: ['#6a2a5a', '#10040c', '#ff80c0'], draw: (L) => {
      L.circle(46, 13, 7, '#f0e8b0');
      L.poly([[18, 30], [33, 2], [40, 18], [48, 30]], '#1a1020');
      L.ellipse(33, 31, 22, 4, '#1a1020');
      L.rect(22, 26, 22, 3, '#8a3aa0');
      L.rect(30, 25, 5, 5, '#e8c070'); L.rect(31, 26, 3, 3, '#8a3aa0');
      L.line(6, 50, 58, 38, 2, '#7a5a30');
      L.poly([[4, 50], [0, 54], [12, 54], [10, 48]], '#c8a040');
    } },
    c: { bg: ['#3a5a8a', '#060c1a', '#ffe0a0'], draw: (L) => {
      L.poly([[18, 10], [48, 10], [48, 30], [33, 46], [18, 30]], '#8aa0c8');
      L.poly([[21, 13], [45, 13], [45, 29], [33, 42], [21, 29]], '#2a3a68');
      L.rect(30, 16, 6, 20, '#e8c070');
      L.circle(33, 22, 5, '#ffe090');
      L.rect(29, 14, 8, 2, '#e8c070');
      L.rect(28, 34, 10, 3, '#e8c070');
    } },
  };

  // ───────────────────────── character portraits ─────────────────────────
  // hat: capotain (หมวกทรงสูง) | coif (ผ้าคลุมผมหญิง) | wig (วิกผมขาว) | none
  const P = {
    abigail: { bg: ['#6a3a4a', '#16060c', '#f0a8c0'], coat: '#5a2a3a', skin: '#f2cca8', hair: '#c86a30', hat: 'coif', prop: 'doll' },
    putnam: { bg: ['#4a5a3a', '#0c1206', '#d8e8b0'], coat: '#3a4a2a', skin: '#f0c8a0', hair: '#6a4020', hat: 'coif', prop: 'quill' },
    bishop: { bg: ['#8a3a2a', '#1a0604', '#ffb090'], coat: '#b8402e', skin: '#e8b890', hair: '#3a2010', hat: 'none', prop: 'coin' },
    mather: { bg: ['#3a3a4a', '#08080c', '#c8c8e0'], coat: '#141418', skin: '#e8b890', hair: '#ece6da', hat: 'wig', prop: 'book' },
    burroughs: { bg: ['#2a4a5a', '#040c10', '#b0d8e8'], coat: '#18181e', skin: '#dcaa84', hair: '#3a2a1a', hat: 'none', prop: 'cross', bands: true },
    gcorey: { bg: ['#4a5a4a', '#0c140c', '#c8e0b8'], coat: '#3a3228', skin: '#d8a880', hair: '#d8d8d0', hat: 'capotain', beard: '#d8d8d0', prop: 'stone' },
    jproctor: { bg: ['#6a5a3a', '#1a1208', '#e8c890'], coat: '#2a2218', skin: '#e8b890', hair: '#5a3a1a', hat: 'capotain', prop: 'mug' },
    eproctor: { bg: ['#5a4a3a', '#140c06', '#e8d0b0'], coat: '#4a3a30', skin: '#f0c8a8', hair: '#8a5a30', hat: 'coif', prop: 'candle' },
    mcorey: { bg: ['#3a4a5a', '#060a12', '#b8c8e0'], coat: '#2a3040', skin: '#e8c0a0', hair: '#8a8078', hat: 'coif', prop: 'book' },
    warren: { bg: ['#5a4a6a', '#140c1a', '#d8b8e8'], coat: '#4a3a5a', skin: '#f0c8a0', hair: '#a06030', hat: 'coif', prop: 'none' },
    nurse: { bg: ['#4a5a7a', '#080c1a', '#b8c8f0'], coat: '#2a2a3a', skin: '#f0c8a8', hair: '#b0a8a0', hat: 'coif', prop: 'book' },
    parris: { bg: ['#4a3a2a', '#0c0804', '#e0c8a0'], coat: '#141418', skin: '#e0b088', hair: '#4a3020', hat: 'capotain', prop: 'cross', bands: true },
    good: { bg: ['#6a3a3a', '#1a0808', '#f0a8a0'], coat: '#5a4030', skin: '#d8a080', hair: '#4a3020', hat: 'coif', prop: 'pipe' },
    osborne: { bg: ['#4a6a6a', '#081414', '#c0e8e0'], coat: '#3a4a48', skin: '#e0c0a8', hair: '#6a6058', hat: 'coif', prop: 'blanket' },
    tituba: { bg: ['#7a4a2a', '#1a0a04', '#ffb870'], coat: '#8a3a28', skin: '#8a5a38', hair: '#1a1008', hat: 'wrap', prop: 'candle' },
  };

  function portrait(id, o) {
    const bg = background(hash(id), o.bg[0], o.bg[1], o.bg[2]);
    return compose(bg, (L) => {
      const cx = 33;
      L.ellipse(cx, 58, 24, 16, o.coat);
      if (o.bands) { L.rect(cx - 3, 42, 6, 9, '#f2eee4'); L.line(cx, 42, cx, 51, 1, '#cfc8b8'); } else {
        L.poly([[cx - 13, 42], [cx + 13, 42], [cx + 8, 50], [cx - 8, 50]], '#f2eee4');
        L.line(cx, 42, cx, 50, 1, '#cfc8b8');
      }
      L.rect(cx - 4, 34, 8, 8, o.skin);
      L.ellipse(cx, 27, 10, 12, o.skin);
      if (o.hat === 'capotain') {
        L.rect(cx - 17, 16, 34, 3, '#1c1814');
        L.poly([[cx - 10, 17], [cx + 10, 17], [cx + 8, 3], [cx - 8, 3]], '#1c1814');
        L.rect(cx - 10, 13, 20, 2, '#8a7040');
        L.rect(cx - 10, 19, 3, 10, o.hair); L.rect(cx + 7, 19, 3, 10, o.hair);
      } else if (o.hat === 'coif') {
        L.ellipse(cx, 22, 13, 13, '#f2eee4');
        L.ellipse(cx, 28, 9, 10, o.skin);
        L.rect(cx - 7, 18, 14, 3, o.hair);
      } else if (o.hat === 'wig') {
        for (const [dx, dy] of [[-11, 18], [-12, 25], [-12, 32], [11, 18], [12, 25], [12, 32], [-6, 15], [0, 14], [6, 15]]) L.circle(cx + dx, dy, 4, o.hair);
        L.ellipse(cx, 28, 9, 10, o.skin);
      } else if (o.hat === 'wrap') {
        L.ellipse(cx, 18, 12, 8, '#d8a030');
        L.rect(cx - 12, 15, 24, 3, '#b83a28');
        L.ellipse(cx, 28, 9, 10, o.skin);
      } else {
        L.ellipse(cx, 18, 11, 7, o.hair);
        L.rect(cx - 11, 18, 3, 14, o.hair); L.rect(cx + 8, 18, 3, 14, o.hair);
      }
      const ey = o.hat === 'coif' || o.hat === 'wig' || o.hat === 'wrap' ? 27 : 26;
      L.px(cx - 4, ey, INK).px(cx - 3, ey, INK).px(cx + 3, ey, INK).px(cx + 4, ey, INK);
      L.px(cx - 4, ey - 2, shade(o.skin, -0.3)).px(cx - 3, ey - 2, shade(o.skin, -0.3));
      L.px(cx + 3, ey - 2, shade(o.skin, -0.3)).px(cx + 4, ey - 2, shade(o.skin, -0.3));
      L.rect(cx - 2, ey + 6, 4, 1, shade(o.skin, -0.35));
      L.px(cx - 6, ey + 3, shade(o.skin, 0.15), 0.8).px(cx + 6, ey + 3, shade(o.skin, 0.15), 0.8);
      if (o.beard) { L.ellipse(cx, ey + 9, 7, 5, o.beard); L.rect(cx - 2, ey + 6, 4, 1, shade(o.skin, -0.35)); }
      switch (o.prop) {
        case 'book': L.rect(cx + 12, 44, 12, 9, '#3a2418'); L.rect(cx + 13, 45, 10, 1, '#d8c890'); L.rect(cx + 17, 46, 2, 5, '#e8c070'); break;
        case 'candle': L.rect(8, 38, 4, 12, '#efe6c8'); L.ellipse(10, 35, 2, 3, '#ffcc40'); L.rect(5, 49, 10, 2, '#8a7040'); break;
        case 'doll': L.circle(52, 40, 3, '#e8d8b0'); L.poly([[48, 53], [52, 42], [56, 53]], '#a06040'); L.px(51, 40, INK).px(53, 40, INK); break;
        case 'quill': L.line(48, 52, 58, 34, 1, '#f4f0e0'); L.poly([[56, 36], [60, 30], [58, 38]], '#f4f0e0'); break;
        case 'coin': L.circle(53, 46, 4, '#e8c070'); L.circle(53, 46, 2, '#b8903a'); L.circle(46, 50, 3, '#e8c070'); break;
        case 'cross': L.rect(51, 36, 3, 14, '#e8c070'); L.rect(47, 40, 11, 3, '#e8c070'); break;
        case 'stone': L.ellipse(53, 48, 8, 5, '#8a8a8a'); L.ellipse(51, 46, 3, 1.5, '#aaaaaa'); break;
        case 'mug': L.rect(48, 40, 9, 11, '#8a6038'); L.rect(57, 43, 3, 5, '#8a6038'); L.rect(49, 40, 7, 2, '#f0e8d0'); break;
        case 'pipe': L.line(cx + 2, ey + 7, cx + 12, ey + 10, 1, '#5a3a20'); L.rect(cx + 11, ey + 7, 3, 4, '#5a3a20'); L.px(cx + 12, ey + 5, '#cfcfcf', 0.7); break;
        case 'blanket': L.poly([[10, 54], [14, 44], [52, 44], [56, 54]], '#6a7a9a'); for (let x = 16; x < 52; x += 6) L.line(x, 45, x + 2, 53, 1, '#8a9aba'); break;
        default: break;
      }
    });
  }

  // ───────────────────────── backs, token, table ─────────────────────────
  function playBack() {
    const { w, h } = SPECS.back;
    const bg = background(22, '#3a1838', '#0c040c', '#8a3a70', w, h, 0.5);
    return compose(bg, (L) => {
      frame(L, w, h, '#e8c070', 4);
      L.circle(33, 36, 15, '#e8c070'); L.circle(38, 32, 13, '#2a1028');
      stars(L, 3, 8, [8, 8, 50, 20], '#e8c070');
      cat(L, 30, 62, 1.1);
      for (const [x, y] of [[10, 10], [55, 10], [10, 83], [55, 83]]) L.rect(x, y, 2, 2, '#e8c070');
    });
  }
  function tryalBack() {
    const { w, h } = SPECS.tryalback;
    const bg = background(21, '#5a3a22', '#1a0e06', '#a07040', w, h, 0.5);
    return compose(bg, (L) => {
      frame(L, w, h, '#e8c070', 3);
      L.rect(21, 18, 2, 24, '#e8c070'); L.rect(12, 18, 20, 2, '#e8c070');
      L.line(14, 20, 11, 30, 1, '#e8c070'); L.line(14, 20, 17, 30, 1, '#e8c070');
      L.line(30, 20, 27, 30, 1, '#e8c070'); L.line(30, 20, 33, 30, 1, '#e8c070');
      L.rect(10, 30, 8, 2, '#e8c070'); L.rect(26, 30, 8, 2, '#e8c070');
      L.rect(15, 42, 14, 3, '#e8c070');
      L.circle(22, 13, 2, '#e8c070');
    });
  }
  function catToken() {
    const { w, h } = SPECS.cat;
    const L = new Canvas(w, h);
    L.circle(12, 12, 11.5, '#e8c070'); L.circle(12, 12, 10, '#2a1830');
    L.ellipse(12, 16, 5, 4, '#0a060a'); L.circle(12, 10, 4, '#0a060a');
    L.poly([[8, 9], [8, 4], [11, 7]], '#0a060a'); L.poly([[13, 7], [16, 4], [16, 9]], '#0a060a');
    L.px(10, 10, '#ffd040').px(14, 10, '#ffd040');
    return L;
  }
  function table() {
    const { w, h } = SPECS.table;
    const r = rng(31);
    const L = new Canvas(w, h);
    L.fill((x, y) => {
      const dx = (x + 0.5 - w / 2) / (w / 2 - 1); const dy = (y + 0.5 - h / 2) / (h / 2 - 1);
      const d = dx * dx + dy * dy;
      if (d > 1) return null;
      if (d > 0.84) return shade('#6a4020', -0.1 + (r() - 0.5) * 0.08);
      if (d > 0.8) return rgbArr('#e8c070');
      const grain = Math.sin(y * 0.9 + Math.sin(x * 0.07) * 3) * 0.05;
      const c = mix('#4a2e18', '#2a180c', Math.sqrt(d));
      return shade(c, grain + (r() - 0.5) * 0.05);
    });
    return L.outline(INK);
  }
  function rgbArr(c) { return R.rgb(c).slice(); }

  // ───────────────────────── public API ─────────────────────────
  const CARD_KEYS = Object.keys(CARD);
  const TRYAL_KEYS = Object.keys(TRYAL);
  const CHAR_KEYS = Object.keys(P);
  const MISC_KEYS = ['back', 'tryalback', 'cat', 'table'];

  function render(kind, id) {
    let img;
    if (kind === 'cards') { const d = CARD[id]; img = compose(background(hash(`card:${id}`), ...d.bg), d.draw); }
    else if (kind === 'tryal') { const d = TRYAL[id]; img = compose(background(hash(`tryal:${id}`), ...d.bg), d.draw); }
    else if (kind === 'chars') img = portrait(id, P[id]);
    else if (kind === 'misc') {
      if (id === 'back') img = playBack();
      else if (id === 'tryalback') img = tryalBack();
      else if (id === 'cat') img = catToken();
      else if (id === 'table') img = table();
    }
    if (!img) throw new Error(`unknown art ${kind}/${id}`);
    const spec = kind === 'misc' ? SPECS[id] : SPECS[kind];
    return img.scale(spec.scale);
  }

  return { VERSION, SPECS, CARD_KEYS, TRYAL_KEYS, CHAR_KEYS, MISC_KEYS, render };
}));
