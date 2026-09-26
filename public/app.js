/* เซเลม 1692 — client (HTML/CSS/JS ล้วน ไม่ต้อง build) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const { esc } = window.CardFace;

function makeToken() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, () => ((Math.random() * 16) | 0).toString(16));
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
let token = store.get('salem_token');
if (!token) { token = makeToken(); store.set('salem_token', token); }

const S = {
  art: {}, meta: null, st: null, offset: 0, online: false,
  sel: null, // การเลือกที่กำลังทำกับ prompt ปัจจุบัน
  modal: null, // { kind, id }
  tab: 'chat', scope: 'all',
  hideResult: false,
  lastChat: 0,
  urlCode: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
};
const M = () => S.meta;

// ════════════════════ socket ════════════════════
const socket = io({ transports: ['websocket', 'polling'] });
socket.on('connect', () => { S.online = true; socket.emit('hello', { token }); render(); });
socket.on('disconnect', () => { S.online = false; render(); });
socket.on('meta', (m) => { S.meta = m; render(); });
fetch('art/manifest.json', { cache: 'no-cache' }).then((r) => r.json()).then((m) => { S.art = m.items || {}; render(); }).catch(() => {});
socket.on('toast', (m) => toast(m));
socket.on('state', (st) => {
  S.offset = st.now - Date.now();
  const prevStatus = S.st && S.st.room && S.st.room.status;
  S.st = st;
  if (st.kicked) toast('คุณถูกเชิญออกจากห้อง');
  if (st.replaced) toast('บัญชีนี้เปิดเล่นอยู่ในแท็บอื่น');
  if (st.room) {
    if (location.search !== `?room=${st.room.code}`) history.replaceState(null, '', `${location.pathname}?room=${st.room.code}`);
    if (st.room.status === 'playing' && prevStatus !== 'playing') { S.hideResult = false; S.modal = null; }
  }
  const pr = curPrompt();
  if (!pr || !S.sel || S.sel.pid !== pr.id) S.sel = pr ? newSel(pr) : null;
  feedIngest();
  const next = feedPump();
  render();
  if (next) animateEvent(F.cur);
});

function send(ev, data) { socket.emit(ev, data); }
function toast(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

// ════════════════════ helpers ════════════════════
const G = () => S.st && S.st.game;
const curPrompt = () => (G() && G().prompt) || null;
const now = () => Date.now() + S.offset;
const newSel = (pr) => ({ pid: pr.id, card: null, power: false, t1: null, abig: false, picks: [] });
function artUrl(kind, id) { const u = S.art[`${kind}/${id}`]; return u ? `art/${u}` : null; }
const cardHTML = (c, o) => CardFace.card(M(), artUrl, c, o);
const P = (seat) => G().players[seat];
const me = () => (G() && G().mySeat !== null ? P(G().mySeat) : null);
const cname = (seat) => M().characters[P(seat).char].name;
const hasBlue = (p, type) => p.blue.some((b) => b.type === type);
const hiddenIdx = (p) => p.tryal.map((c, i) => (c.revealed ? -1 : i)).filter((i) => i >= 0);
function roomPlayer(pid) { return S.st.room.players.find((p) => p.pid === pid) || {}; }
function roleOf(p) {
  if (!p) return '';
  if (p.witch) return 'แม่มด';
  if (p.tryal.some((c) => c.kind === 'c' && (c.mine || c.revealed))) return 'ผู้คุ้มกัน (ชาวเมือง)';
  return 'ชาวเมือง';
}

// ════════════════════ targeting (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ) ════════════════════
function handCard(id) { return G().hand.find((c) => c.id === id); }
function validSeats() {
  const pr = curPrompt();
  const sel = S.sel;
  const out = new Set();
  if (!pr || pr.type !== 'turn' || !sel) return out;
  const m = me();
  const alive = G().players.filter((p) => p.alive);
  const add = (f) => alive.filter(f).forEach((p) => out.add(p.seat));
  const others = (f) => add((p) => p !== m && f(p)); // กติกา: ห้ามเล่นการ์ดใส่ตัวเอง
  if (sel.power) {
    if (m.char === 'mather') { if (sel.t1 === null) add((p) => p !== m); } else if (m.char === 'jproctor') add((p) => p !== m && !hasBlue(p, 'piety'));
    else if (m.char === 'parris') add((p) => p.red.some((r) => r.type === 'accusation'));
    return out;
  }
  const c = sel.card && handCard(sel.card);
  if (!c) return out;
  const d = M().cards[c.type];
  if (d.color === 'red') others((p) => !hasBlue(p, 'piety'));
  else if (c.type === 'stocks') others((p) => p.char !== 'osborne');
  else if (c.type === 'arson') others((p) => p.char !== 'mcorey');
  else if (c.type === 'alibi') others(() => true);
  else if (d.color === 'blue') others((p) => !hasBlue(p, c.type));
  else if (c.type === 'scapegoat') others((p) => sel.t1 === null || p.seat !== sel.t1);
  else if (c.type === 'robbery') others((p) => (sel.t1 === null ? p.char !== 'mcorey' : p.seat !== sel.t1));
  else if (c.type === 'curse') { if (sel.t1 === null) others((p) => p.char !== 'burroughs' && (p.blue.length || G().catSeat === p.seat)); }
  return out;
}
function canPower() {
  const m = me();
  if (!m || m.used || M().characters[m.char].kind !== 'once') return false;
  if (m.char === 'abigail') return false; // ใช้ผ่านการ์ดกล่าวหา
  if (m.char === 'jproctor') return m.red.some((r) => r.type === 'accusation');
  if (m.char === 'parris') return G().players.some((p) => p.alive && p.red.some((r) => r.type === 'accusation'));
  if (m.char === 'tituba') return G().deckCount > 0;
  return true;
}

function answer(data) {
  const pr = curPrompt();
  if (!pr) return;
  send('answer', { promptId: pr.id, data });
  S.sel = newSel(pr);
  S.sel.sent = true;
  render();
}

function pickSeat(seat) {
  const pr = curPrompt();
  const sel = S.sel;
  if (pr && pr.type === 'turn' && sel && validSeats().has(seat)) {
    const m = me();
    if (sel.power) {
      if (m.char === 'mather') { sel.t1 = seat; render(); return; }
      answer({ action: 'power', target: seat });
      return;
    }
    const c = handCard(sel.card);
    if (c.type === 'scapegoat' || c.type === 'robbery') {
      if (sel.t1 === null) { sel.t1 = seat; render(); return; }
      answer({ action: 'play', card: c.id, target: sel.t1, target2: seat });
      return;
    }
    if (c.type === 'curse') { sel.t1 = seat; render(); return; }
    answer({ action: 'play', card: c.id, target: seat, power: !!sel.abig });
    return;
  }
  if (pr && (pr.type === 'witchVote' || pr.type === 'protect') && pr.options.includes(seat)) { answer({ target: seat }); return; }
  S.modal = { kind: 'seat', id: seat };
  render();
}

// ════════════════════ rendering ════════════════════
function snapshotInputs() {
  const a = document.activeElement;
  const vals = {};
  document.querySelectorAll('#app input[id]').forEach((i) => { vals[i.id] = i.value; });
  return { vals, focus: a && a.id, start: a && a.selectionStart, end: a && a.selectionEnd };
}
function restoreInputs(s) {
  for (const [id, v] of Object.entries(s.vals)) { const el = document.getElementById(id); if (el) el.value = v; }
  if (s.focus) {
    const el = document.getElementById(s.focus);
    if (el) { el.focus(); try { el.setSelectionRange(s.start, s.end); } catch { /* */ } }
  }
}

const cache = {};
/** เปลี่ยน HTML เฉพาะเมื่อเนื้อหาเปลี่ยนจริง — ส่วนที่ไม่เปลี่ยน (เช่น การ์ดในมือ) จะไม่ถูกสร้างใหม่ระหว่างที่คนอื่นเล่น */
function setHTML(el, key, html) {
  if (cache[key] === html && el.dataset.k === key) return false;
  el.innerHTML = html;
  el.dataset.k = key;
  cache[key] = html;
  return true;
}

function render() {
  const app = $('#app');
  const snap = snapshotInputs();
  const box = $('#msgbox');
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const handScroll = $('.hand') ? $('.hand').scrollLeft : 0;
  const inGame = S.meta && S.st && S.st.room && S.st.room.status !== 'lobby' && G();
  if (!inGame) {
    let html;
    if (!S.meta || !S.st) html = `<div class="loading">${S.online ? 'กำลังโหลด…' : 'กำลังเชื่อมต่อเซิร์ฟเวอร์…'}</div>`;
    else if (!S.st.room) html = homeHTML();
    else html = lobbyHTML();
    setHTML(app, 'screen', html);
  } else {
    if (!$('#g-root')) {
      app.innerHTML = `<div id="g-root"><div class="top" id="r-top"></div><div class="game"><div class="main">
        <div id="r-feed"></div><div class="tablewrap" id="tw"></div><div id="r-prompt"></div><div id="r-hand"></div></div>
        <div class="side" id="r-side"></div></div></div>`;
      app.dataset.k = 'game';
    }
    const parts = gameParts();
    setHTML($('#r-top'), 'top', parts.top);
    setHTML($('#r-feed'), 'feed', feedHTML());
    const tw = $('#tw');
    tw.className = `tablewrap ${parts.night ? 'night' : ''}`;
    tw.style.setProperty('--sw', `${parts.sw}px`);
    setHTML(tw, 'table', parts.table);
    setHTML($('#r-prompt'), 'prompt', parts.prompt);
    setHTML($('#r-hand'), 'hand', parts.hand);
    setHTML($('#r-side'), 'side', parts.side);
    layoutTable();
  }
  restoreInputs(snap);
  const box2 = $('#msgbox');
  if (box2 && atBottom) box2.scrollTop = box2.scrollHeight;
  if ($('.hand') && $('.hand').scrollLeft !== handScroll) $('.hand').scrollLeft = handScroll;
  setHTML($('#modal'), 'modal', modalHTML());
  tick();
}

// ── หน้าแรก ──
function homeHTML() {
  const name = store.get('salem_name') || '';
  return `<div class="home">
    <div class="logo"><img class="logo-art" src="${esc(artUrl('cards', 'night') || '')}" alt="">
      <h1>เซเลม 1692</h1><p>เกมการ์ดล่าแม่มด · 4–12 คน · หลอกล่อ กล่าวหา เอาตัวรอด</p></div>
    <div class="panel"><h3>ชื่อของคุณ</h3><input type="text" id="name" maxlength="16" placeholder="เช่น สมชาย" value="${esc(name)}" style="width:100%"></div>
    ${S.urlCode ? `<div class="panel"><h3>ได้รับคำเชิญเข้าห้อง ${esc(S.urlCode)}</h3>
      <button class="btn gold big" style="width:100%" data-act="join" data-code="${esc(S.urlCode)}">เข้าห้อง ${esc(S.urlCode)}</button></div>` : ''}
    <div class="panel"><h3>สร้างห้องใหม่</h3><button class="btn ${S.urlCode ? '' : 'gold'} big" style="width:100%" data-act="create">สร้างห้อง</button></div>
    <div class="panel"><h3>เข้าห้องด้วยรหัส</h3><div class="row"><input type="text" id="code" maxlength="4" placeholder="รหัส 4 ตัว" style="text-transform:uppercase"><button class="btn" data-act="join">เข้าห้อง</button></div></div>
    <div class="foot-links"><a href="#" data-info="rules:">📜 วิธีเล่น</a><a href="gallery.html">🖼 คลังภาพการ์ด</a></div>
  </div>`;
}

// ── ห้องรอ ──
function lobbyHTML() {
  const r = S.st.room;
  const host = r.hostPid === S.st.me;
  const n = r.players.length;
  const t = M().tryalTable[n];
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  const ended = r.status === 'ended';
  return `<div class="lobby">
    <div style="display:grid;gap:12px;min-width:0">
      <div class="panel"><div class="row"><div><div class="muted small">รหัสห้อง</div><div class="code-big">${esc(r.code)}</div></div><span class="sp"></span>
        <button class="btn" data-act="copy" data-link="${esc(link)}">🔗 คัดลอกลิงก์เชิญ</button></div>
        <div class="muted small" style="overflow-wrap:anywhere">${esc(link)}</div></div>
      <div class="panel"><h3>ผู้เล่น ${n}/${M().maxPlayers} <span class="hint">${t ? `แม่มด ${t[1]} ใบ · การ์ดไต่สวนคนละ ${t[0]} ใบ` : `ต้องมีอย่างน้อย ${M().minPlayers} คน`}</span></h3>
        <div class="plist">${r.players.map((p) => `<div class="pl"><span class="n">${esc(p.name)}</span>
          ${p.pid === S.st.me ? '<span class="badge me">คุณ</span>' : ''}${p.pid === r.hostPid ? '<span class="badge host">หัวห้อง</span>' : ''}
          ${p.isBot ? '<span class="badge bot">บอท</span>' : ''}${!p.connected && !p.isBot ? '<span class="badge off">หลุด</span>' : ''}
          ${host && p.pid !== S.st.me && !ended ? `<button class="btn sm ghost" data-act="kick" data-pid="${esc(p.pid)}">เตะ</button>` : ''}</div>`).join('')}</div>
        <div class="actions">
          ${host && !ended ? `<button class="btn" data-act="addBot" ${n >= M().maxPlayers ? 'disabled' : ''}>🤖 เพิ่มบอท</button>
            <button class="btn gold" data-act="start" ${n < M().minPlayers ? 'disabled' : ''}>▶ เริ่มเกม</button>` : ''}
          ${host && ended ? '<button class="btn gold" data-act="toLobby">🔁 เล่นอีกครั้ง</button>' : ''}
          ${!host ? '<span class="muted small">รอหัวห้องเริ่มเกม…</span>' : ''}
          <span class="sp"></span><button class="btn sm ghost" data-act="leave">ออกจากห้อง</button></div></div>
      <div class="foot-links"><a href="#" data-info="rules:">📜 วิธีเล่น</a><a href="gallery.html" target="_blank">🖼 คลังภาพการ์ด</a></div>
    </div>
    ${chatHTML(false)}
  </div>`;
}

// ── เกม ──
function sizing(n) {
  const wide = window.innerWidth >= 900;
  if (wide) return { th: n <= 7 ? 500 : n <= 10 ? 560 : 610, sw: n <= 8 ? 92 : 80 };
  return { th: n <= 5 ? 470 : n <= 7 ? 530 : n <= 9 ? 590 : 650, sw: n <= 7 ? 74 : 68 };
}
function turnText() {
  const g = G();
  if (g.phase === 'over') return 'จบเกม';
  if (g.phase === 'dawn') return '🌅 รุ่งอรุณ';
  if (g.phase === 'night') return `🌙 ราตรีที่ ${g.nightNo}`;
  if (g.phase === 'confess') return '🕯 ช่วงสารภาพ';
  if (g.phase === 'conspiracy') return '🐈‍⬛ สมรู้ร่วมคิด';
  if (g.activeSeat === null) return g.phaseName;
  return g.activeSeat === g.mySeat ? 'ตาของ <span style="color:var(--gold)">คุณ</span>' : `ตาของ ${esc(cname(g.activeSeat))}`;
}
function deadlineOf() {
  const pr = curPrompt();
  if (pr) return pr.deadline;
  const w = G().waiting[0];
  return w ? w.deadline : null;
}
function gameParts() {
  const g = G();
  const r = S.st.room;
  const n = g.players.length;
  const dl = deadlineOf();
  const top = g.discardTop;
  return {
    night: g.phase === 'night' || g.phase === 'confess' || g.phase === 'dawn',
    sw: sizing(n).sw,
    top: `<span>ห้อง <span class="code">${esc(r.code)}</span></span>
      <span class="turn">${turnText()}</span>
      ${dl ? `<span class="timer" data-dl="${dl}">⏱ --</span>` : ''}
      <button class="btn sm ghost" data-act="leave" title="ออกจากเกม (บอทเล่นแทน)">ออก</button>`,
    table: `<div class="tableimg" style="background-image:url('${esc(artUrl('misc', 'table') || '')}')"></div>
      <div class="center">
        <div class="pile" style="background-image:url('${esc(artUrl('misc', 'back') || '')}')"><span>กอง ${g.deckCount}</span></div>
        <div class="pile discard ${top ? '' : 'empty'}" ${top ? `data-info="card:${top.type}"` : ''}>${top ? `<div class="mini-art" style="background-image:url('${esc(artUrl('cards', top.type) || '')}')"></div><b>${esc(M().cards[top.type].name)}</b>` : ''}<span>ทิ้ง ${g.discardCount}</span></div>
      </div>
      <div class="phase-tag">${esc(g.phaseName)}${g.nightNo ? ` · ราตรีผ่านไป ${g.nightNo}` : ''}</div>
      ${g.players.map(seatHTML).join('')}
      <svg class="arrows" id="arrows"></svg>
      <!--${F.cur ? F.cur.id : 0}-->`,
    prompt: promptHTML(),
    hand: handHTML(),
    side: chatHTML(true),
  };
}

function seatHTML(p) {
  const g = G();
  const valid = validSeats();
  const pr = curPrompt();
  const voteOpt = pr && (pr.type === 'witchVote' || pr.type === 'protect') && pr.options.includes(p.seat);
  const cls = ['seat'];
  if (p.seat === g.mySeat) cls.push('me');
  if (p.seat === g.activeSeat && g.phase === 'day') cls.push('turn');
  if (!p.alive) cls.push('dead');
  if (valid.has(p.seat) || voteOpt) cls.push('pick');
  if (S.sel && S.sel.t1 === p.seat) cls.push('picked');
  const rp = roomPlayer(p.pid);
  const who = seatName(p, rp);
  const tr = p.tryal.map((c) => (c.revealed ? `<div class="tr ${c.kind}" title="${esc(M().tryals[c.kind].name)}">${c.kind === 'nw' ? '✓' : c.kind === 'w' ? '☠' : '★'}</div>`
    : `<div class="tr ${c.mine ? 'mine' : ''}" style="background-image:url('${esc(artUrl('misc', 'tryalback') || '')}')" title="${c.mine ? esc(M().tryals[c.kind].name) + ' (คว่ำอยู่)' : 'คว่ำอยู่'}"></div>`)).join('');
  const chips = [
    ...p.blue.map((b) => `<span class="chip blue">${esc(M().cards[b.type].name)}</span>`),
    p.stocked ? `<span class="chip stk">ขื่อคา${p.stocked > 1 ? ` ×${p.stocked}` : ''}</span>` : '',
    g.gavelSeat === p.seat && p.alive ? '<span class="chip gavel" title="ผู้คุ้มกันวางค้อนปกป้องคนนี้ในราตรีล่าสุด">🔨 ค้อน</span>' : '',
    p.witch && p.seat !== g.mySeat && g.phase !== 'over' ? '<span class="chip witch">แม่มด</span>' : '',
  ].join('');
  const badge = p.seat === g.mySeat ? '<span class="sbadge">คุณ</span>' : p.seat === g.activeSeat && g.phase === 'day' ? '<span class="sbadge turnb">ตานี้</span>' : '';
  return `<div class="${cls.join(' ')}" data-seat="${p.seat}">${badge}
    <div class="pt" style="background-image:url('${esc(artUrl('chars', p.char) || '')}')">${g.catSeat === p.seat ? `<div class="catok" title="แมวดำ" style="background-image:url('${esc(artUrl('misc', 'cat') || '')}')"></div>` : ''}</div>
    <div class="nm">${esc(M().characters[p.char].name)}</div>
    <div class="pl">${p.alive ? who : '☠ ตายแล้ว'}</div>
    <div class="tryals">${tr}</div>
    ${p.alive ? `<div class="meter"><i style="width:${Math.min(100, (p.total / p.threshold) * 100)}%"></i></div>
    <div class="row2"><span title="แต้มกล่าวหา">⚖<b>${p.total}/${p.threshold}</b></span><span title="การ์ดในมือ">✋${p.handCount}</span></div>` : ''}
    <div class="chips">${chips}</div></div>`;
}

/** ชื่อผู้เล่นใต้ชื่อตัวละคร (ย่อให้พอดีที่นั่ง) */
function seatName(p, rp) {
  const short = (t, n) => (Array.from(t).length > n ? `${Array.from(t).slice(0, n - 1).join('')}…` : t);
  let t = p.isBot && !rp.left ? `🤖${short(p.name.replace(/^บอท/, ''), 6)}` : short(p.name, 8);
  if (rp.left) t = `🤖แทน ${short(p.name, 4)}`;
  else if (!p.connected && !p.isBot) t = `⚠ ${short(p.name, 6)}`;
  return esc(t);
}

/** จัดที่นั่งรอบโต๊ะวงรี: ที่นั่งของเราอยู่ล่างสุด แล้ววนตามเข็มนาฬิกาตามลำดับการเล่น */
function layoutTable() {
  const tw = $('#tw');
  if (!tw) return;
  const g = G();
  const els = [...tw.querySelectorAll('.seat')];
  const W = tw.clientWidth;
  const sw = els[0].offsetWidth;
  const sh = Math.max(...els.map((e) => e.offsetHeight));
  const n = g.players.length;
  const base = g.mySeat ?? 0;
  const place = (H) => {
    const rx = Math.max(0, (W - sw) / 2 - 2); const ry = Math.max(0, (H - sh) / 2 - 4);
    const pos = {};
    for (const e of els) {
      const seat = Number(e.dataset.seat);
      const i = (seat - base + n) % n;
      const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
      pos[seat] = [W / 2 + rx * Math.cos(a), H / 2 + ry * Math.sin(a)];
    }
    return pos;
  };
  const clash = (pos) => {
    const pts = Object.values(pos);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(pts[i][0] - pts[j][0]) < sw + 4 && Math.abs(pts[i][1] - pts[j][1]) < sh + 4) return true;
    }
    return false;
  };
  // ขยายความสูงโต๊ะจนที่นั่งไม่ทับกัน (ขึ้นกับจำนวนผู้เล่นและขนาดจอ)
  let H = sizing(n).th;
  let pos = place(H);
  while (clash(pos) && H < 2000) { H += 16; pos = place(H); }
  tw.style.height = `${H}px`;
  for (const e of els) {
    const [x, y] = pos[e.dataset.seat];
    e.style.left = `${x}px`; e.style.top = `${y}px`;
  }
  drawArrows(tw, pos, sh);
}

function arrowEvents() {
  const e = F.cur;
  return e && e.from !== null && e.to.length && e.card ? [e] : [];
}
function drawArrows(tw, pos, sh) {
  const svg = $('#arrows');
  tw.querySelectorAll('.arrowtag').forEach((t) => t.remove());
  tw.querySelectorAll('.seat.hit').forEach((t) => t.classList.remove('hit'));
  if (F.cur) {
    for (const to of F.cur.to) { const el = tw.querySelector(`.seat[data-seat="${to}"]`); if (el) el.classList.add('hit'); }
    const a = F.cur.from !== null && tw.querySelector(`.seat[data-seat="${F.cur.from}"]`);
    if (a) a.classList.add('actor');
  }
  tw.querySelectorAll('.seat.actor').forEach((t) => { if (!F.cur || Number(t.dataset.seat) !== F.cur.from) t.classList.remove('actor'); });
  let paths = '<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#ff5a3a"/></marker><marker id="ahg" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#7ae07a"/></marker></defs>';
  for (const e of arrowEvents()) {
    const d = M().cards[e.card];
    const col = e.card === 'power' ? 'power' : d ? d.color : 'red';
    const label = e.card === 'power' ? 'พลังพิเศษ' : `${d.name}${d.color === 'red' ? ` +${e.value}` : ''}`;
    e.to.forEach((to, k) => {
      if (!pos[e.from] || !pos[to]) return;
      const hit = tw.querySelector(`.seat[data-seat="${to}"]`);
      if (hit) hit.classList.add('hit');
      if (to === e.from) return;
      const [x0, y0] = pos[e.from]; const [x1, y1] = pos[to];
      const dx = x1 - x0; const dy = y1 - y0; const L = Math.hypot(dx, dy) || 1;
      const s0 = Math.min(0.4, (sh * 0.45) / L); const s1 = Math.min(0.45, (sh * 0.5) / L);
      const ax = x0 + dx * s0; const ay = y0 + dy * s0; const bx = x1 - dx * s1; const by = y1 - dy * s1;
      const mx = (ax + bx) / 2 - dy * 0.12; const my = (ay + by) / 2 + dx * 0.12;
      const good = col === 'green' && (e.card === 'alibi') || col === 'blue';
      const stroke = good ? '#7ae07a' : col === 'power' ? '#c090f0' : '#ff5a3a';
      paths += `<path d="M${ax},${ay} Q${mx},${my} ${bx},${by}" stroke="#000" stroke-width="6" fill="none" opacity=".5"/>
        <path d="M${ax},${ay} Q${mx},${my} ${bx},${by}" stroke="${stroke}" stroke-width="3" stroke-dasharray="7 4" fill="none" marker-end="url(#${good ? 'ahg' : 'ah'})"/>`;
      if (k === 0) {
        const tag = document.createElement('div');
        tag.className = `arrowtag ${col}`;
        tag.textContent = label;
        tag.style.left = `${(ax + 2 * mx + bx) / 4}px`;
        tag.style.top = `${(ay + 2 * my + by) / 4}px`;
        tw.appendChild(tag);
      }
    });
  }
  svg.innerHTML = paths;
}

// ── คำสั่งที่รออยู่ ──
function backBtn(seat, i, act) {
  return `<div class="card cf tback mini" data-act="${act}" data-idx="${i}" title="ใบที่ ${i + 1}" style="background-image:url('${esc(artUrl('misc', 'tryalback') || '')}')"></div>`;
}
function seatButtons(opts, act = 'vote') {
  return `<div class="choices">${opts.map((s) => `<button class="btn sm" data-act="${act}" data-seat="${s}">${esc(cname(s))}${s === G().mySeat ? ' (คุณ)' : ''}</button>`).join('')}</div>`;
}
function promptHTML() {
  const g = G();
  const pr = curPrompt();
  const m = me();
  if (g.phase === 'over') return `<div class="prompt"><div class="ptitle">🏁 ${esc(g.result ? g.result.text : 'จบเกม')}</div>
    <div class="actions"><button class="btn gold" data-act="showResult">ดูผลเกม</button></div></div>`;
  if (!pr || (S.sel && S.sel.sent)) return waitHTML();
  const sel = S.sel;
  const wrap = (title, desc, body, cls = '') => `<div class="prompt ${cls}"><div class="ptitle">${title}</div>${desc ? `<div class="pdesc">${desc}</div>` : ''}${body}</div>`;
  switch (pr.type) {
    case 'turn': {
      if (sel.power) {
        const ch = M().characters[m.char];
        let body = '';
        if (m.char === 'mather' && sel.t1 !== null) body = `<div class="pdesc">เลือกการ์ดใบที่จะแอบดูของ ${esc(cname(sel.t1))}</div><div class="choices">${hiddenIdx(P(sel.t1)).map((i) => backBtn(sel.t1, i, 'peek')).join('')}</div>`;
        return wrap(`✨ ใช้พลัง「${esc(ch.power)}」`, esc(ch.desc) + (sel.t1 === null ? ' — แตะที่นั่งผู้เล่นบนโต๊ะเพื่อเลือก' : ''), `${body}<div class="actions"><button class="btn" data-act="cancel">ยกเลิก</button></div>`);
      }
      if (sel.card) {
        const c = handCard(sel.card);
        if (!c) return '';
        const d = M().cards[c.type];
        let step = 'แตะที่นั่งผู้เล่นที่ไฮไลต์สีเขียวบนโต๊ะ';
        if (c.type === 'scapegoat') step = sel.t1 === null ? 'เลือกผู้เล่นคนแรก (ย้ายการ์ด "จาก" คนนี้)' : `ย้ายจาก ${esc(cname(sel.t1))} → เลือกผู้เล่นที่จะรับการ์ด`;
        if (c.type === 'robbery') step = sel.t1 === null ? 'เลือกผู้เล่นที่จะถูกปล้นการ์ดในมือ' : `ปล้นจาก ${esc(cname(sel.t1))} → เลือกผู้รับ (ให้ตัวเองไม่ได้)`;
        let extra = '';
        if (c.type === 'curse' && sel.t1 !== null) {
          step = `เลือกการ์ดน้ำเงินหน้า ${esc(cname(sel.t1))} ที่จะทำลาย`;
          extra = `<div class="choices">${P(sel.t1).blue.map((b) => `<button class="btn sm" data-act="curse" data-id="${b.id}">${esc(M().cards[b.type].name)}</button>`).join('')}${G().catSeat === sel.t1 ? '<button class="btn sm" data-act="curse" data-id="cat">🐈‍⬛ แมวดำ</button>' : ''}</div>`;
        }
        if (c.type === 'accusation' && m.char === 'abigail' && !m.used) {
          extra += `<label class="btn sm ${sel.abig ? 'on' : ''}" style="margin-top:8px"><input type="checkbox" data-act="abig" ${sel.abig ? 'checked' : ''}> ใช้「เสียงกรีดร้อง」ให้นับ 3 แต้ม (ครั้งเดียว)</label>`;
        }
        return wrap(`เล่น「${esc(d.name)}」`, `${esc(d.short)} — ${step}`, `${extra}<div class="actions"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn sm ghost" data-info="card:${c.type}">ℹ กติกาเต็ม</button></div>`);
      }
      const powerBtn = canPower() ? `<button class="btn witch" data-act="power">✨ ใช้พลัง: ${esc(M().characters[m.char].power)}</button>` : '';
      const body = `<div class="actions">
        ${!pr.played ? `<button class="btn gold" data-act="draw">จั่ว 2 ใบ</button>` : ''}
        ${!pr.played && m.char === 'warren' ? '<button class="btn" data-act="draw3">จั่ว 3 ทิ้ง 1 (พลังแมรี)</button>' : ''}
        ${pr.played ? '<button class="btn gold" data-act="end">จบตา</button>' : ''}${powerBtn}</div>`;
      return wrap('ตาของคุณ!', pr.played ? 'เล่นการ์ดต่อได้ หรือกด "จบตา"' : 'แตะการ์ดในมือเพื่อเล่น (เล่นได้หลายใบ) หรือจั่ว 2 ใบแทน — เลือกได้อย่างใดอย่างหนึ่ง', body);
    }
    case 'reveal': {
      const t = P(pr.target);
      const why = pr.why === 'cat' ? `สมรู้ร่วมคิด: เลือกการ์ดของผู้ถือแมวดำ (${esc(cname(t.seat))}) ให้เปิด` : `${esc(cname(t.seat))} ถูกกล่าวหาครบเกณฑ์ — เลือกการ์ดไต่สวนที่คว่ำอยู่ 1 ใบให้เปิด`;
      return wrap('⚖ เลือกการ์ดที่จะเปิด', why, `<div class="choices">${pr.indexes.map((i) => backBtn(t.seat, i, 'idx')).join('')}</div>`);
    }
    case 'conspTake': {
      const t = P(pr.target);
      return wrap('🐈‍⬛ สมรู้ร่วมคิด', `หยิบการ์ดไต่สวน 1 ใบจาก ${esc(cname(t.seat))} (ผู้เล่นทางซ้าย) — คุณไม่เห็นหน้าการ์ด`, `<div class="choices">${pr.indexes.map((i) => backBtn(t.seat, i, 'idx')).join('')}</div>`);
    }
    case 'bribe':
      return wrap('💰 ติดสินบน?', `คุณถูกกล่าวหาครบเกณฑ์ ใช้พลังบริดเจ็ต: เลือกการ์ดในมือ 2 ใบเพื่อทิ้งแทนการเปิดการ์ดไต่สวน (เลือกแล้ว ${sel.picks.length}/2)`,
        `<div class="actions"><button class="btn gold" data-act="bribeYes" ${sel.picks.length === 2 ? '' : 'disabled'}>ติดสินบน</button><button class="btn" data-act="bribeNo">ไม่ใช้ เปิดการ์ด</button></div>`);
    case 'discard1':
      return wrap('ทิ้งการ์ด 1 ใบ', 'แตะการ์ดในมือที่จะทิ้ง', `<div class="actions"><button class="btn gold" data-act="discard1" ${sel.picks.length === 1 ? '' : 'disabled'}>ทิ้งใบที่เลือก</button></div>`);
    case 'tituba': {
      const order = sel.picks;
      return wrap('🔮 ทำนาย', 'การ์ด 3 ใบบนสุดของกองจั่ว (ซ้าย = บนสุด) แตะตามลำดับที่ต้องการให้ถูกจั่ว', `<div class="choices">${pr.cards.map((c) => {
        const k = order.indexOf(c.id);
        return cardHTML(c, { mini: true, attrs: `data-act="tit" data-id="${c.id}"`, extra: k >= 0 ? `<span class="ord">${k + 1}</span>` : '', cls: k >= 0 ? 'picked' : '' });
      }).join('')}</div><div class="actions"><button class="btn gold" data-act="titOk" ${order.length === pr.cards.length ? '' : 'disabled'}>ยืนยันลำดับ</button><button class="btn" data-act="titReset">เริ่มใหม่</button></div>`);
    }
    case 'witchVote': {
      const title = pr.kind === 'cat' ? '🧹 แม่มด: มอบแมวดำให้ใคร?' : '🧹 แม่มด: เลือกเหยื่อคืนนี้';
      const prev = pr.prev && Object.keys(pr.prev).length ? `<div class="votes">รอบแรกแม่มดเลือกไม่ตรงกัน: ${Object.entries(pr.prev).map(([w, t]) => `${esc(cname(Number(w)))} → ${esc(cname(t))}`).join(' · ')}</div>` : '';
      return wrap(title, 'แม่มดต้องเลือกให้ตรงกัน ถ้าไม่ตรงกันจะเลือกอีกรอบ แล้วใช้เสียงข้างมาก (แตะที่นั่งหรือปุ่มด้านล่าง)', `${prev}${seatButtons(pr.options)}`, 'night');
    }
    case 'protect':
      return wrap('🛡 ผู้คุ้มกัน: ปกป้องใครคืนนี้?', 'ผู้เล่นที่คุณเลือกจะไม่ถูกแม่มดฆ่าคืนนี้ (เลือกตัวเองไม่ได้)', seatButtons(pr.options), 'night');
    case 'confess': {
      const hid = hiddenIdx(m);
      const btns = hid.map((i) => {
        const k = m.tryal[i].kind;
        const warn = k === 'w' ? ' ⚠ ตาย!' : hid.length === 1 ? ' ⚠ ใบสุดท้าย ตาย!' : '';
        return `<button class="btn sm ${k === 'w' || hid.length === 1 ? 'red' : ''}" data-act="confess" data-idx="${i}">เปิด「${esc(M().tryals[k].name)}」${warn}</button>`;
      }).join('');
      return wrap('🕯 จะสารภาพไหม?', 'สารภาพ = เปิดการ์ดไต่สวนของคุณ 1 ใบให้ทุกคนเห็น ถ้าแม่มดเลือกคุณคืนนี้ คุณจะรอด', `<div class="choices">${btns}<button class="btn gold" data-act="confess" data-idx="none">ไม่สารภาพ</button></div>`, 'night');
    }
    default: return '';
  }
}
function waitHTML() {
  const g = G();
  const w = g.waiting.filter((x) => x.seat !== g.mySeat);
  let text = '';
  const night = g.phase === 'night' || g.phase === 'dawn';
  if (night && !w.length) text = g.phase === 'dawn' ? '🌅 แม่มดกำลังแอบมองหน้ากันและเลือกผู้ถือแมวดำ…' : '🌙 ทุกคนหลับตา… แม่มดและผู้คุ้มกันกำลังตัดสินใจในความมืด';
  else if (w.some((x) => x.type === 'confess')) text = `🕯 รอผู้เล่นตัดสินใจสารภาพ (${w.length} คน)…`;
  else if (w.some((x) => x.type === 'conspTake')) text = `🐈‍⬛ รอผู้เล่นหยิบการ์ดจากคนทางซ้าย (${w.length} คน)…`;
  else if (w.length) {
    const x = w[0];
    const nm = esc(cname(x.seat));
    text = x.type === 'turn' ? `รอ ${nm} เล่น…` : x.type === 'reveal' ? `รอ ${nm} เลือกการ์ดที่จะเปิด…` : x.type === 'bribe' ? `รอ ${nm} ตัดสินใจติดสินบน…` : `รอ ${nm}…`;
  } else if (S.sel && S.sel.sent) text = 'ส่งคำตอบแล้ว รอผู้เล่นอื่น…';
  else text = 'กำลังดำเนินเกม…';
  return `<div class="prompt wait ${night ? 'night' : ''}"><div class="ptitle">${text}</div></div>`;
}

function handHTML() {
  const g = G();
  const m = me();
  if (!m) return '';
  const pr = curPrompt();
  const sel = S.sel;
  const myTurn = pr && pr.type === 'turn' && sel && !sel.sent;
  const picking = pr && (pr.type === 'bribe' || pr.type === 'discard1') && !sel.sent;
  const mates = g.players.filter((p) => p.witch && p.seat !== g.mySeat);
  const roles = [
    CardFace.character(M(), artUrl, m.char, { mini: true, attrs: `data-info="char:${m.char}"` }),
    ...m.tryal.map((c) => CardFace.tryal(M(), artUrl, c.kind, { mini: true, attrs: `data-info="tryal:${c.kind}"`, extra: `<div class="cf-state">${c.revealed ? 'เปิดแล้ว' : 'คว่ำอยู่'}</div>` })),
  ].join('');
  const hand = g.hand.map((c) => {
    const cls = [sel && sel.card === c.id ? 'sel' : '', sel && sel.picks.includes(c.id) ? 'picked' : ''].join(' ');
    const act = myTurn || picking ? 'hand' : 'info';
    return cardHTML(c, { cls, attrs: `data-act="${act}" data-id="${c.id}" data-type="${c.type}"`, extra: `<span class="info" data-info="card:${c.type}">i</span>` });
  }).join('');
  return `<div class="panel">
    <h3>บทบาทของคุณ: <span class="role ${m.witch ? 'witch' : ''}">${roleOf(m)}</span>
      ${m.witch && mates.length ? `<span class="hint">พวกพ้องแม่มด: ${mates.map((p) => esc(cname(p.seat))).join(', ')}</span>` : ''}</h3>
    <div class="myroles">${roles}</div>
    <h3 style="margin-top:6px">การ์ดในมือ (${g.hand.length}) <span class="hint">แตะปุ่ม i เพื่อดูกติกาเต็ม</span></h3>
    <div class="hand">${hand || '<span class="muted small">ไม่มีการ์ดในมือ</span>'}</div>
  </div>`;
}

// ── แชท / บันทึก ──
function chatHTML(inGame) {
  const r = S.st.room;
  const g = G();
  const m = inGame ? me() : null;
  const tab = inGame ? S.tab : 'chat';
  let body;
  if (tab === 'log') {
    const notes = m && m.notes.length ? `<div class="notes"><b>ข้อมูลลับของคุณ</b>${m.notes.slice().reverse().map((x) => `<div>${esc(x.text)}</div>`).join('')}</div>` : '';
    body = `${notes}<div class="log">${g.log.slice().reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>`;
  } else {
    body = r.chat.map((c) => {
      if (!c.from) return `<div class="msg sys"><div class="tx">${esc(c.text)}</div></div>`;
      const p = g && c.seat !== null && c.seat !== undefined ? P(c.seat) : null;
      const av = p ? `style="background-image:url('${esc(artUrl('chars', p.char) || '')}')"` : '';
      const mine = g ? c.seat === g.mySeat : c.from === (roomPlayer(S.st.me).name);
      const who = p ? `${esc(M().characters[p.char].name)} <small>${esc(c.from)}</small>` : esc(c.from);
      return `<div class="msg ${mine ? 'mine' : ''} ${c.scope === 'witch' ? 'wch' : ''}"><div class="av" ${av}></div><div><div class="who">${c.scope === 'witch' ? '🧹 ' : ''}${who}</div><div class="tx">${esc(c.text)}</div></div></div>`;
    }).join('');
  }
  const canWitch = inGame && m && m.witch && g.phase !== 'over';
  return `<div class="panel">
    ${inGame ? `<div class="tabs"><button class="tab ${tab === 'chat' ? 'on' : ''}" data-tab="chat">แชท</button><button class="tab ${tab === 'log' ? 'on' : ''}" data-tab="log">บันทึกเกม</button>
      <button class="tab" data-info="rules:">วิธีเล่น</button></div>` : '<h3>แชทในห้อง</h3>'}
    <div class="msgs ${tab === 'log' ? '' : ''}" id="msgbox">${body || '<div class="muted small">ยังไม่มีข้อความ</div>'}</div>
    ${tab === 'chat' ? `${inGame ? `<div class="quick">${['ฉันไม่ใช่แม่มด!', 'ใครน่าสงสัยที่สุด?', 'เชื่อฉันสิ', 'ช่วยกันกล่าวหาหน่อย'].map((q) => `<button data-act="quick">${q}</button>`).join('')}</div>` : ''}
      <div class="say">${canWitch ? `<button class="btn sm ${S.scope === 'witch' ? 'witch' : ''}" data-act="scope" title="สลับช่องส่งข้อความ">${S.scope === 'witch' ? '🧹 แม่มด' : 'ทุกคน'}</button>` : ''}
      <input type="text" id="chatin" maxlength="200" placeholder="${S.scope === 'witch' && canWitch ? 'คุยลับกับแม่มด…' : 'พิมพ์ข้อความ…'}"><button class="btn gold" data-act="say">ส่ง</button></div>` : ''}
  </div>`;
}

// ── หน้าต่าง ──
function rulesHTML() {
  const t = M().tryalTable;
  return `<div class="rules"><h2>📜 วิธีเล่น เซเลม 1692</h2>
    <p>ทุกคนได้ <b>การ์ดไต่สวน</b> คว่ำไว้หลายใบ ถ้าใครมีการ์ด <b>แม่มด</b> คนนั้นคือแม่มด (แม่มดรู้จักกันเอง) การ์ด <b>ผู้คุ้มกัน</b> มี 1 ใบ ที่เหลือคือ "ไม่ใช่แม่มด"</p>
    <h3>รุ่งอรุณ</h3><p>แม่มดแอบเลือกผู้ถือ <b>แมวดำ</b> — ผู้ถือแมวดำเป็นคนเริ่มเล่นก่อน แล้ววนตามเข็มนาฬิกา</p>
    <h3>ในตาของคุณ เลือก 1 อย่าง</h3><ul><li><b>จั่วการ์ด 2 ใบ</b> หรือ</li><li><b>เล่นการ์ดจากมือ</b> กี่ใบก็ได้ (ถือการ์ดได้ไม่จำกัด)</li></ul><p><b>ห้ามเล่นการ์ดใส่ตัวเอง</b> ทุกกรณี</p>
    <h3>การกล่าวหา</h3><p>การ์ดสีแดงวางหน้าผู้เล่น (กล่าวหา +1, หลักฐาน +3, พยาน +7) เมื่อครบ 7 แต้ม ผู้ที่เล่นใบสุดท้ายเลือกการ์ดไต่สวนที่คว่ำอยู่ของเขา 1 ใบให้เปิด ถ้าเป็น <b>แม่มด</b> ผู้นั้นตายทันที ใครถูกเปิดการ์ดหมดก็ตาย</p>
    <h3>ราตรี</h3><p>การ์ดราตรีอยู่ใบล่างสุดของกองจั่วเสมอ เมื่อจั่วถึง แม่มดตกลงเลือกเหยื่อ ผู้คุ้มกันวาง <b>ค้อน</b> หน้าผู้เล่นอื่น 1 คน (ทุกคนเห็น) แล้วทุกคนเลือกว่าจะ <b>สารภาพ</b> (เปิดการ์ดของตัวเอง 1 ใบ) หรือไม่ เหยื่อที่มีค้อน สารภาพ หรือมีสถานพักพิงจะรอด ถ้าการ์ดผู้คุ้มกันถูกเปิด จะไม่มีผู้คุ้มกันอีกต่อไป จากนั้นสับกองทิ้งเป็นกองใหม่ และราตรีกลับไปอยู่ล่างสุด</p>
    <h3>สมรู้ร่วมคิด</h3><p>ผู้จั่วเลือกการ์ดของผู้ถือแมวดำให้เปิด 1 ใบ แล้วทุกคนหยิบการ์ดไต่สวน 1 ใบจากคนทางซ้าย ใครได้การ์ดแม่มดกลายเป็นแม่มด</p>
    <h3>ชนะ</h3><ul><li><b>ชาวเมือง</b>: การ์ดแม่มดทุกใบถูกเปิด</li><li><b>แม่มด</b>: ผู้เล่นที่ยังมีชีวิตเหลือแต่แม่มด</li></ul>
    <h3>จำนวนการ์ดไต่สวน</h3><p>${Object.entries(t).map(([n, [per, w]]) => `${n} คน: คนละ ${per} ใบ แม่มด ${w}`).join(' · ')}</p>
    <h3>การ์ดทั้งหมด</h3><ul>${Object.values(M().cards).map((c) => `<li><b>${esc(c.name)}</b> (${c.count} ใบ): ${esc(c.desc)}</li>`).join('')}</ul>
    <div class="actions"><button class="btn gold" data-act="close">ปิด</button></div></div>`;
}
function resultHTML() {
  const g = G();
  const r = g.result;
  const host = S.st.room.hostPid === S.st.me;
  const title = r.winner === 'town' ? '🏛 ชาวเมืองชนะ!' : r.winner === 'witch' ? '🧹 แม่มดชนะ!' : 'เสมอ';
  const iWon = r.winners.includes(S.st.me);
  return `<div class="rtitle ${r.winner}">${title}</div><p style="text-align:center">${esc(r.text)}<br><b>${iWon ? '🎉 คุณชนะ!' : 'คุณแพ้ในเกมนี้'}</b></p>
    <div class="rlist">${r.roles.map((p) => `<div class="rrow ${r.winners.includes(p.pid) ? 'win' : ''}">
      <div class="av" style="background-image:url('${esc(artUrl('chars', p.char) || '')}')"></div>
      <div><div class="n">${esc(M().characters[p.char].name)} <span class="muted small">${esc(p.name)}</span></div>
        <div class="t">${p.tryal.map((k) => esc(M().tryals[k].name)).join(' · ')}</div></div>
      <div class="small" style="text-align:right">${p.witch ? '🧹 แม่มด' : '🏛 ชาวเมือง'}<br>${p.alive ? 'รอด' : '☠ ตาย'}</div></div>`).join('')}</div>
    <div class="actions">${host ? '<button class="btn gold" data-act="toLobby">🔁 เล่นอีกครั้ง</button>' : '<span class="muted small">รอหัวห้องกด "เล่นอีกครั้ง"</span>'}
      <button class="btn" data-act="hideResult">ดูกระดาน</button></div>`;
}
function modalHTML() {
  if (!S.meta || !S.st) return '';
  const g = G();
  let body = '';
  if (g && g.result && !S.hideResult && S.st.room.status !== 'lobby' && !feedBusy()) body = resultHTML();
  else if (S.modal) {
    const { kind, id } = S.modal;
    if (kind === 'rules') body = rulesHTML();
    else if (kind === 'card') { const c = M().cards[id]; body = `<div class="cols">${cardHTML({ id: 0, type: id })}<div style="flex:1;min-width:180px"><h2>${esc(c.name)}</h2><div class="muted small">${esc(CardFace.typeLine(M(), id))} · ในสำรับ ${c.count} ใบ</div><p>${esc(c.desc)}</p></div></div>`; }
    else if (kind === 'tryal') { const t = M().tryals[id]; body = `<div class="cols">${CardFace.tryal(M(), artUrl, id)}<div style="flex:1;min-width:180px"><h2>${esc(t.name)}</h2><p>${esc(t.desc)}</p></div></div>`; }
    else if (kind === 'char') { const c = M().characters[id]; body = `<div class="cols">${CardFace.character(M(), artUrl, id)}<div style="flex:1;min-width:180px"><h2>${esc(c.name)}</h2><div class="muted small">พลัง「${esc(c.power)}」 · ${c.kind === 'passive' ? 'ทำงานอัตโนมัติ' : 'ครั้งเดียวต่อเกม'}</div><p>${esc(c.desc)}</p></div></div>`; }
    else if (kind === 'seat' && g) {
      const p = P(Number(id));
      body = `<div class="cols">${CardFace.character(M(), artUrl, p.char)}<div style="flex:1;min-width:180px"><h2>${esc(M().characters[p.char].name)}</h2>
        <div class="muted small">ผู้เล่น: ${esc(p.name)}${p.isBot ? ' (บอท)' : ''} · ${p.alive ? 'ยังมีชีวิต' : 'ตายแล้ว'}</div>
        <p>${esc(M().characters[p.char].desc)}${p.used ? ' <b>(ใช้พลังแล้ว)</b>' : ''}</p>
        <p>กล่าวหา <b>${p.total}/${p.threshold}</b> แต้ม${p.red.length ? `: ${p.red.map((r) => `${esc(M().cards[r.type].name)} +${r.value}`).join(', ')}` : ''}<br>
        การ์ดน้ำเงิน: ${p.blue.length ? p.blue.map((b) => esc(M().cards[b.type].name)).join(', ') : '-'}<br>
        การ์ดในมือ ${p.handCount} ใบ${g.catSeat === p.seat ? ' · 🐈‍⬛ ถือแมวดำ' : ''}${p.stocked ? ' · ติดขื่อคา' : ''}</p></div></div>`;
    }
    if (body) body += kind === 'rules' ? '' : '<div class="actions"><button class="btn gold" data-act="close">ปิด</button></div>';
  }
  return body ? `<div class="modal-bg" data-act="bg"><div class="modal">${body}</div></div>` : '';
}

// ════════════════════ แถบ "เกิดอะไรขึ้น" + แอนิเมชัน ════════════════════
// เหตุการณ์จากเซิร์ฟเวอร์ถูกแสดงทีละอย่างตามเวลาที่กำหนด (ms) — ถ้าค้างหลายอย่าง (เช่นเพิ่งกลับเข้าเกม) จะเร่ง/ข้ามของเก่า
const F = { room: null, seen: 0, queue: [], cur: null, until: 0, dur: 0 };
function feedIngest() {
  const g = G();
  if (!g) return;
  const ev = g.events || [];
  const last = ev[ev.length - 1];
  if (F.room !== S.st.room.code || (last && last.id < F.seen) || (!last && F.seen)) {
    // ห้องใหม่ / เกมใหม่ / เพิ่งเปิดหน้า: แสดงเหตุการณ์ล่าสุดทันทีโดยไม่เล่นย้อนหลัง
    Object.assign(F, { room: S.st.room.code, queue: [], cur: last || null, seen: last ? last.id : 0, until: 0, dur: 0 });
    return;
  }
  for (const e of ev) if (e.id > F.seen) { F.queue.push(e); F.seen = e.id; }
  if (F.queue.length > 6) F.queue = F.queue.slice(-3);
}
function feedPump() {
  const t = Date.now();
  if (!F.queue.length || t < F.until) return false;
  const e = F.queue.shift();
  const k = F.queue.length > 2 ? 0.45 : 1;
  F.cur = e;
  F.dur = Math.round(e.ms * k);
  F.until = t + F.dur;
  return true;
}
const feedBusy = () => F.queue.length > 0 || Date.now() < F.until;

function feedArt(e) {
  if (e.card && e.card !== 'power') return artUrl('cards', e.card);
  if (e.art) return artUrl(e.art[0], e.art[1]);
  if (e.card === 'power' && e.from !== null) return artUrl('chars', P(e.from).char);
  return null;
}
function feedTone(e) {
  if (e.kind === 'death') return 'death';
  if (e.kind === 'reveal') return e.art && e.art[1] === 'w' ? 'witch' : 'reveal';
  if (e.kind === 'night' || e.kind === 'black' || e.kind === 'cat') return 'night';
  if (e.card === 'power') return 'power';
  if (e.card) return M().cards[e.card].color;
  return 'plain';
}
function feedHTML() {
  const e = F.cur;
  if (!e) return '<div class="act-strip plain"><div class="tx"><span class="tag">เกิดอะไรขึ้น</span><br>เกมกำลังเริ่ม…</div></div>';
  const pic = (seat) => (seat === null || seat === undefined ? '' : `<div class="av" title="${esc(cname(seat))}" style="background-image:url('${esc(artUrl('chars', P(seat).char) || '')}')"></div>`);
  const art = feedArt(e);
  const pics = [
    pic(e.from),
    art && !(e.kind === 'death') ? `<div class="cardimg" style="background-image:url('${esc(art)}')"></div>` : '',
    e.from !== null && e.to.length ? '<span class="ar">➜</span>' : '',
    ...e.to.map(pic),
  ].filter(Boolean).join('');
  const busy = Date.now() < F.until;
  return `<div class="act-strip ${feedTone(e)}" data-ev="${e.id}"><div class="pics">${pics}</div>
    <div class="tx"><span class="tag">เกิดอะไรขึ้น${F.queue.length ? ` · อีก ${F.queue.length} เหตุการณ์` : ''}</span><br>${esc(e.text)}</div>
    ${busy ? `<div class="bar" style="animation-duration:${F.dur}ms"></div>` : ''}</div>`;
}

/** การ์ดบินจากผู้เล่นไปหาเป้าหมาย แล้วเป้าหมายสั่น / การ์ดที่ถูกเปิดหรือคนตายจะกะพริบ */
function animateEvent(e) {
  if (!e || !G()) return;
  const seatEl = (s) => document.querySelector(`#tw .seat[data-seat="${s}"]`);
  const shake = (s, cls = 'shake') => {
    const el = seatEl(s);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => { const x = seatEl(s); if (x) x.classList.remove(cls); }, 900);
  };
  if (e.from !== null && e.to.length && e.card) {
    const art = feedArt(e);
    e.to.forEach((to, i) => {
      const a = seatEl(e.from); const b = seatEl(to);
      if (!a || !b || to === e.from) { shake(to); return; }
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const fly = document.createElement('div');
      fly.className = `fly ${feedTone(e)}`;
      if (art) fly.style.backgroundImage = `url('${art}')`;
      fly.style.left = `${ra.left + ra.width / 2 - 26}px`;
      fly.style.top = `${ra.top + ra.height / 2 - 22}px`;
      document.body.appendChild(fly);
      setTimeout(() => {
        fly.style.transform = `translate(${rb.left - ra.left + (rb.width - ra.width) / 2}px, ${rb.top - ra.top + (rb.height - ra.height) / 2}px) rotate(${i ? -8 : 8}deg) scale(1.15)`;
      }, 30 + i * 180);
      setTimeout(() => { fly.classList.add('land'); shake(to); }, 820 + i * 180);
      setTimeout(() => fly.remove(), 1250 + i * 180);
    });
  } else if (e.to.length) {
    e.to.forEach((to) => shake(to, e.kind === 'death' ? 'flash' : 'pulse'));
  }
}

setInterval(() => {
  const wasBusy = feedBusy();
  if (feedPump()) { render(); animateEvent(F.cur); } else if (wasBusy !== feedBusy() || (F.cur && F.until && Date.now() >= F.until && $('.act-strip .bar'))) render();
}, 150);

// ════════════════════ timers ════════════════════
function tick() {
  document.querySelectorAll('[data-dl]').forEach((el) => {
    const s = Math.max(0, Math.ceil((Number(el.dataset.dl) - now()) / 1000));
    el.textContent = `⏱ ${s}`;
    el.classList.toggle('low', s <= 10);
  });
}
setInterval(tick, 500);
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (G()) layoutTable(); });

// ════════════════════ events ════════════════════
function nameVal() {
  const v = ($('#name') && $('#name').value.trim()) || store.get('salem_name') || '';
  if (v) store.set('salem_name', v);
  return v;
}
function sendChat(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const g = G();
  const witch = g && me() && me().witch && S.scope === 'witch' && g.phase !== 'over';
  send('chat', { text: t, scope: witch ? 'witch' : 'all' });
}

document.addEventListener('click', (e) => {
  const info = e.target.closest('[data-info]');
  if (info) {
    e.preventDefault();
    e.stopPropagation();
    const [kind, id] = info.dataset.info.split(':');
    S.modal = { kind, id };
    render();
    return;
  }
  const el = e.target.closest('[data-act], [data-seat], [data-tab]');
  if (!el) return;
  if (el.dataset.tab) { S.tab = el.dataset.tab; render(); return; }
  const act = el.dataset.act;
  if (!act && el.dataset.seat !== undefined) { pickSeat(Number(el.dataset.seat)); return; }
  const pr = curPrompt();
  const sel = S.sel;
  switch (act) {
    case 'create': send('create', { name: nameVal() }); break;
    case 'join': {
      const code = (el.dataset.code || ($('#code') && $('#code').value) || '').trim().toUpperCase();
      if (code.length !== 4) { toast('ใส่รหัสห้อง 4 ตัว'); break; }
      send('join', { code, name: nameVal() });
      break;
    }
    case 'copy': {
      const link = el.dataset.link;
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('คัดลอกลิงก์แล้ว'), () => toast(link));
      else toast(link);
      break;
    }
    case 'addBot': send('addBot'); break;
    case 'kick': send('kick', { pid: el.dataset.pid }); break;
    case 'start': send('start'); break;
    case 'leave':
      if (!G() || G().phase === 'over' || confirm('ออกจากเกม? บอทจะเล่นแทนคุณจนจบเกม')) { S.urlCode = ''; send('leave'); history.replaceState(null, '', location.pathname); }
      break;
    case 'toLobby': S.hideResult = true; send('toLobby'); break;
    case 'hideResult': S.hideResult = true; render(); break;
    case 'showResult': S.hideResult = false; render(); break;
    case 'close': S.modal = null; render(); break;
    case 'bg': if (e.target === el) { if (G() && G().result && !S.hideResult) S.hideResult = true; S.modal = null; render(); } break;
    case 'say': { const i = $('#chatin'); sendChat(i.value); i.value = ''; break; }
    case 'quick': sendChat(el.textContent); break;
    case 'scope': S.scope = S.scope === 'witch' ? 'all' : 'witch'; render(); break;
    case 'info': S.modal = { kind: 'card', id: el.dataset.type }; render(); break;
    case 'hand': {
      const id = Number(el.dataset.id);
      if (!pr) break;
      if (pr.type === 'turn') {
        if (M().cards[el.dataset.type].color === 'black') break;
        S.sel = { ...newSel(pr), card: sel.card === id ? null : id };
      } else if (pr.type === 'bribe') {
        sel.picks = sel.picks.includes(id) ? sel.picks.filter((x) => x !== id) : [...sel.picks, id].slice(-2);
      } else if (pr.type === 'discard1') sel.picks = [id];
      render();
      break;
    }
    case 'cancel': S.sel = newSel(pr); render(); break;
    case 'draw': answer({ action: 'draw' }); break;
    case 'draw3': answer({ action: 'draw3' }); break;
    case 'end': answer({ action: 'end' }); break;
    case 'power':
      if (me().char === 'tituba') answer({ action: 'power' });
      else { S.sel = { ...newSel(pr), power: true }; render(); }
      break;
    case 'peek': answer({ action: 'power', target: sel.t1, index: Number(el.dataset.idx) }); break;
    case 'curse': answer({ action: 'play', card: sel.card, target: sel.t1, blue: el.dataset.id === 'cat' ? 'cat' : Number(el.dataset.id) }); break;
    case 'idx': answer({ index: Number(el.dataset.idx) }); break;
    case 'vote': answer({ target: Number(el.dataset.seat) }); break;
    case 'confess': answer({ index: el.dataset.idx === 'none' ? null : Number(el.dataset.idx) }); break;
    case 'bribeYes': answer({ use: true, cards: sel.picks }); break;
    case 'bribeNo': answer({ use: false }); break;
    case 'discard1': answer({ card: sel.picks[0] }); break;
    case 'tit': { const id = Number(el.dataset.id); if (!sel.picks.includes(id)) sel.picks.push(id); render(); break; }
    case 'titReset': sel.picks = []; render(); break;
    case 'titOk': answer({ order: sel.picks }); break;
    default: break;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'abig' && S.sel) { S.sel.abig = e.target.checked; render(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { S.modal = null; if (G() && G().result) S.hideResult = true; render(); return; }
  if (e.key !== 'Enter') return;
  if (e.target.id === 'chatin') { sendChat(e.target.value); e.target.value = ''; }
  if (e.target.id === 'code') $('[data-act="join"]:not([data-code])').click();
  if (e.target.id === 'name' && !S.urlCode) $('[data-act="create"]').click();
});
