/* คลังภาพ: แสดงภาพที่บันทึกถาวร + ข้อมูลการ์ด (อ่านอย่างเดียว) และวาดใหม่สดจากตัวสร้างภาพเพื่อตรวจสอบ */
'use strict';

const { esc } = window.CardFace;
const S = { db: null, manifest: null, tab: 'cards', live: false, checks: {} };
const MISC = {
  back: ['หลังการ์ดเล่น', 'ด้านหลังของการ์ดเล่นทุกใบ (กองจั่ว)'],
  tryalback: ['หลังการ์ดไต่สวน', 'ด้านหลังของการ์ดไต่สวนที่คว่ำอยู่หน้าผู้เล่น'],
  cat: ['แมวดำ', 'โทเคนแมวดำ แม่มดมอบให้ผู้เล่นหนึ่งคนตอนรุ่งอรุณ ใช้ตอนเกิด "สมรู้ร่วมคิด"'],
  table: ['โต๊ะวงรี', 'โต๊ะไม้กลางห้องเล่น ผู้เล่นนั่งล้อมรอบตามลำดับการเล่น'],
};
const TABS = {
  cards: 'การ์ดเล่น', tryal: 'การ์ดไต่สวน', chars: 'ตัวละคร', misc: 'หลังการ์ด & อื่น ๆ',
};

async function init() {
  const [db, manifest] = await Promise.all([
    fetch('api/cards').then((r) => r.json()),
    fetch('art/manifest.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  Object.assign(S, { db, manifest });
  render();
}

function keysOf(tab) {
  if (tab === 'cards') return Object.keys(S.db.cards);
  if (tab === 'tryal') return Object.keys(S.db.tryals);
  if (tab === 'chars') return Object.keys(S.db.characters);
  return Object.keys(MISC);
}
const artUrl = (kind, id) => { const u = S.manifest.items[`${kind}/${id}`]; return u ? `art/${u}` : null; };

function faceHTML(kind, id) {
  if (kind === 'cards') return CardFace.card(S.db, artUrl, { id: 0, type: id });
  if (kind === 'tryal') return CardFace.tryal(S.db, artUrl, id);
  if (kind === 'chars') return CardFace.character(S.db, artUrl, id);
  if (id === 'back') return CardFace.card(S.db, artUrl, null);
  if (id === 'tryalback') return CardFace.tryal(S.db, artUrl, null);
  return `<img class="wide" src="${esc(artUrl('misc', id))}" alt="${esc(MISC[id][0])}">`;
}

function metaHTML(kind, id) {
  if (kind === 'cards') {
    const c = S.db.cards[id];
    return `<b>${esc(c.name)}</b><div class="sub">${esc(CardFace.typeLine(S.db, id))} · ในสำรับ ${c.count} ใบ</div><p>${esc(c.desc)}</p>`;
  }
  if (kind === 'tryal') {
    const t = S.db.tryals[id];
    const counts = Object.entries(S.db.tryalTable).map(([n, [per, w]]) => `${n} คน: ${id === 'w' ? w : id === 'c' ? 1 : per * n - w - 1}`).join(' · ');
    return `<b>${esc(t.name)}</b><div class="sub">การ์ดไต่สวน (บทบาทลับ)</div><p>${esc(t.desc)}</p><div class="sub">จำนวนในเกม — ${esc(counts)}</div>`;
  }
  if (kind === 'chars') {
    const c = S.db.characters[id];
    return `<b>${esc(c.name)}</b><div class="sub">พลัง「${esc(c.power)}」 · ${c.kind === 'passive' ? 'ทำงานอัตโนมัติ' : 'ครั้งเดียวต่อเกม'}</div><p>${esc(c.desc)}</p>`;
  }
  const [name, desc] = MISC[id];
  return `<b>${esc(name)}</b><p>${esc(desc)}</p>`;
}

function render() {
  const { manifest } = S;
  const n = Object.keys(manifest.items).length;
  const kind = S.tab;
  document.getElementById('app').innerHTML = `<div class="gal">
    <div class="gbar2"><h1>🖼 คลังภาพ เซเลม 1692</h1><span class="sp"></span>
      <label class="btn sm"><input type="checkbox" id="live" ${S.live ? 'checked' : ''}> วาดใหม่สดจากโค้ดเพื่อเทียบ</label>
      <a class="btn sm" href="/">กลับไปเกม</a></div>
    <div class="note">ภาพทั้ง ${n} ภาพวาดจากโค้ดทีละพิกเซล (RGBA) ด้วย <code>public/artgen/</code> และบันทึกถาวรเป็นไฟล์ใน <code>public/art/</code> พร้อมลายนิ้วมือ SHA-256 —
      ไม่ใช้ภาพจาก AI ไม่ใช้ภาพจากเกมจริง ไม่มีระบบแก้ไขหรืออัปโหลด และการทดสอบจะตรวจว่าไฟล์ตรงกับตัวสร้างภาพทุกพิกเซล (${esc(manifest.generator)})</div>
    <div class="tabs">${Object.entries(TABS).map(([k, label]) => `<button class="btn sm ${S.tab === k ? 'on' : ''}" data-tab="${k}">${label} (${keysOf(k).length})</button>`).join('')}</div>
    <div class="items">${keysOf(kind).map((id) => {
      const key = `${kind}/${id}`;
      const url = manifest.items[key];
      const chk = S.checks[key];
      return `<div class="item">
        <div class="pics">${faceHTML(kind, id)}${url ? `<img hidden src="art/${esc(url)}" alt="" data-key="${esc(key)}">` : ''}${S.live ? `<canvas data-live="${esc(key)}" title="วาดใหม่สดในเบราว์เซอร์"></canvas>` : ''}</div>
        <div class="meta">${metaHTML(kind, id)}
          <div class="hash">sha256 ${esc((manifest.sha256[`${key}.png`] || '').slice(0, 16))}…</div>
          ${S.live ? `<div class="small ${chk === true ? 'ok' : chk === false ? 'bad' : ''}" data-chk="${esc(key)}">${chk === true ? '✓ วาดใหม่ได้ตรงกับไฟล์ทุกพิกเซล' : chk === false ? '✗ ไม่ตรงกับไฟล์' : 'กำลังตรวจ…'}</div>` : ''}
        </div></div>`;
    }).join('')}</div></div>`;
  if (S.live) requestAnimationFrame(drawLive);
}

function drawLive() {
  for (const cv of document.querySelectorAll('canvas[data-live]')) {
    const key = cv.dataset.live;
    const [kind, id] = key.split('/');
    const img = window.ArtDesigns.render(kind, id);
    cv.width = img.w;
    cv.height = img.h;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h), 0, 0);
    const saved = document.querySelector(`img[data-key="${key}"]`);
    if (saved && S.checks[key] === undefined) compare(key, saved, img);
  }
}

/** เทียบภาพที่วาดสดกับไฟล์ที่บันทึกไว้ทีละพิกเซล */
function compare(key, el, img) {
  const run = () => {
    const c = document.createElement('canvas');
    c.width = img.w;
    c.height = img.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(el, 0, 0);
    const got = ctx.getImageData(0, 0, img.w, img.h).data;
    let same = got.length === img.d.length;
    for (let i = 0; same && i < got.length; i += 4) {
      if (Math.abs(got[i + 3] - img.d[i + 3]) > 1) same = false;
      else if (got[i + 3] && (Math.abs(got[i] - img.d[i]) > 1 || Math.abs(got[i + 1] - img.d[i + 1]) > 1 || Math.abs(got[i + 2] - img.d[i + 2]) > 1)) same = false;
    }
    S.checks[key] = same;
    const box = document.querySelector(`[data-chk="${key}"]`);
    if (box) { box.className = `small ${same ? 'ok' : 'bad'}`; box.textContent = same ? '✓ วาดใหม่ได้ตรงกับไฟล์ทุกพิกเซล' : '✗ ไม่ตรงกับไฟล์'; }
  };
  if (el.complete) run(); else el.addEventListener('load', run, { once: true });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { S.tab = t.dataset.tab; render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'live') { S.live = e.target.checked; render(); }
});

init().catch((e) => { document.getElementById('app').innerHTML = `<div class="loading">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`; });
