/* หน้าการ์ด (ภาพ → ชื่อ → ประเภท → ผลโดยย่อ) ใช้ร่วมกันระหว่างเกมและคลังภาพ */
(function (root) {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bg = (url) => (url ? ` style="background-image:url('${esc(url)}')"` : '');

  function typeLine(M, type) {
    const c = M.cards[type];
    const col = M.colors[c.color].name;
    if (c.color === 'red') return `${col} · กล่าวหา +${c.value}`;
    if (c.color === 'green') return `${col} · ทันที`;
    if (c.color === 'blue') return `${col} · ถาวร`;
    return `${col} · เหตุการณ์`;
  }

  function face(o) {
    const cls = `card cf ${o.col || ''} ${o.mini ? 'mini' : ''} ${o.cls || ''}`;
    const head = `<div class="cf-art"${bg(o.art)}></div><div class="cf-name">${esc(o.name)}</div>`;
    if (o.mini) return `<div class="${cls}" ${o.attrs || ''} title="${esc(o.title)}">${head}${o.extra || ''}</div>`;
    return `<div class="${cls}" ${o.attrs || ''} title="${esc(o.title)}">${head}<div class="cf-type">${esc(o.type)}</div><div class="cf-text">${esc(o.text)}</div>${o.extra || ''}</div>`;
  }

  /** การ์ดเล่น c = {id,type} หรือ null (หลังการ์ด) */
  function card(M, artUrl, c, o = {}) {
    if (!c || !c.type) return `<div class="card cf back ${o.mini ? 'mini' : ''} ${o.cls || ''}" ${o.attrs || ''}${bg(artUrl('misc', 'back'))}></div>`;
    const d = M.cards[c.type];
    return face({ ...o, col: d.color, art: artUrl('cards', c.type), name: d.name, type: typeLine(M, c.type), text: d.short, title: `${d.name}: ${d.desc}` });
  }

  /** การ์ดไต่สวน kind = nw | w | c | null (คว่ำ) */
  function tryal(M, artUrl, kind, o = {}) {
    if (!kind) return `<div class="card cf tback ${o.mini ? 'mini' : ''} ${o.cls || ''}" ${o.attrs || ''}${bg(artUrl('misc', 'tryalback'))}></div>`;
    const d = M.tryals[kind];
    return face({ ...o, col: `t-${kind}`, art: artUrl('tryal', kind), name: d.name, type: 'การ์ดไต่สวน', text: d.short, title: `${d.name}: ${d.desc}` });
  }

  /** การ์ดตัวละคร: ภาพ → ชื่อ → พลัง → ผลโดยย่อ */
  function character(M, artUrl, id, o = {}) {
    const d = M.characters[id];
    return face({ ...o, col: 'char', art: artUrl('chars', id), name: d.name, type: `พลัง: ${d.power}`, text: d.short, title: `${d.name} — ${d.power}: ${d.desc}` });
  }

  root.CardFace = { card, tryal, character, typeLine, esc };
}(typeof self !== 'undefined' ? self : this));
