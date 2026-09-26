'use strict';

// บอทแบบ heuristic ที่รู้กติกา — ใช้ข้อมูลเท่าที่ผู้เล่นคนนั้นควรรู้เท่านั้น
// ชาวเมือง: ประเมินความน่าสงสัยจากการ์ดที่ยังคว่ำ พฤติกรรมการกล่าวหา/ปกป้อง และสิ่งที่แอบดูมา
// แม่มด: รู้จักพวกเดียวกัน เล็งชาวเมืองที่อันตราย ปกป้องพวกพ้อง และบางครั้งสารภาพเพื่อกลบเกลื่อน

const { CARDS } = require('./cards');

const rnd = (g) => g.rnd();

/** ความจำของบอทแต่ละคน (อัปเดตจากเหตุการณ์สาธารณะ) */
function mind(p) {
  const m = p.mind;
  if (!m.sus) { m.sus = {}; m.acc = {}; m.def = {}; m.noise = {}; }
  return m;
}

/** รับรู้เหตุการณ์สาธารณะ (engine เรียกผ่าน observe ให้ผู้เล่นทุกคน) */
function observe(g, ev) {
  for (const p of g.players) {
    const m = mind(p);
    const bump = (seat, k) => { m.sus[seat] = (m.sus[seat] || 0) + k; };
    switch (ev.type) {
      case 'accuse':
        m.acc[ev.from] = m.acc[ev.from] || {};
        m.acc[ev.from][ev.to] = (m.acc[ev.from][ev.to] || 0) + 1;
        if (ev.to === p.seat && !p.witch) bump(ev.from, 0.8); // รู้ว่าตัวเองบริสุทธิ์ คนกล่าวหาเรามีพิรุธ
        break;
      case 'defend':
        m.def[ev.from] = m.def[ev.from] || {};
        m.def[ev.from][ev.to] = (m.def[ev.from][ev.to] || 0) + 1;
        if (ev.to === p.seat && !p.witch) bump(ev.from, -0.4);
        break;
      case 'hostile':
        if (ev.to === p.seat && !p.witch) bump(ev.from, 0.6);
        break;
      case 'reveal':
      case 'death': {
        const isWitch = ev.type === 'reveal' ? ev.kind === 'w' : ev.witch;
        for (const [from, tos] of Object.entries(m.acc)) {
          if (!tos[ev.seat]) continue;
          if (isWitch) bump(Number(from), -1.2);
          else if (ev.type === 'reveal' && ev.kind === 'nw') bump(Number(from), 0.15);
        }
        for (const [from, tos] of Object.entries(m.def)) {
          if (tos[ev.seat] && isWitch) bump(Number(from), 2.5);
        }
        break;
      }
      default: break;
    }
  }
}

/** ความน่าจะเป็นที่ผู้เล่น q เป็นแม่มด (มุมมองของ p ชาวเมือง) */
function suspicion(g, p, q) {
  const m = mind(p);
  if (m.noise[q.seat] === undefined) m.noise[q.seat] = rnd(g) * 0.5;
  const myHidden = p.tryal.filter((c) => !c.revealed);
  const witchLeft = g.players.flatMap((x) => x.tryal).filter((c) => c.kind === 'w' && !c.revealed).length
    - myHidden.filter((c) => c.kind === 'w').length;
  let otherHidden = 0;
  for (const x of g.alive()) if (x !== p) otherHidden += g.hidden(x).length;
  let s = otherHidden ? (witchLeft * g.hidden(q).length) / otherHidden * 4 : 0;
  if (q.tryal.some((c) => c.revealed && c.kind === 'c')) s -= 3;
  s += (m.sus[q.seat] || 0) + m.noise[q.seat];
  const pk = m.peek;
  if (pk && pk.seat === q.seat) {
    const still = q.tryal.find((c) => c.id === pk.id && !c.revealed);
    if (still) s += pk.kind === 'w' ? 12 : -0.6;
  }
  return s;
}

/** คะแนน "อยากกำจัด" ของแม่มดต่อชาวเมือง q (ใช้ข้อมูลที่แม่มดทุกตัวเห็นเหมือนกัน เพื่อให้เลือกตรงกัน) */
function danger(g, q) {
  let s = q.tryal.filter((c) => c.revealed && c.kind === 'nw').length * 0.8;
  if (q.tryal.some((c) => c.revealed && c.kind === 'c')) s += 4;
  s += q.hand.length * 0.15;
  for (const w of g.players.filter((x) => x.witch)) {
    const acc = (mind(w).acc[q.seat] || {});
    for (const [to, n] of Object.entries(acc)) if (g.players[to].witch) s += n * 0.9;
  }
  return s + ((q.seat * 7919) % 13) / 100; // ตัดสินเสมอแบบคงที่
}

const others = (g, p) => g.alive().filter((q) => q !== p);
const argmax = (arr, f) => arr.reduce((b, x) => (b === null || f(x) > f(b) ? x : b), null);

/** เป้าหมายหลักที่บอทอยากให้ถูกเปิดการ์ด */
function mainTarget(g, p, filter = () => true) {
  const cand = others(g, p).filter(filter);
  if (!cand.length) return null;
  if (p.witch) {
    const town = cand.filter((q) => !q.witch);
    if (!town.length) return null;
    // ใกล้ครบเกณฑ์ก่อน แล้วค่อยดูความอันตราย
    return argmax(town, (q) => g.total(q) / g.threshold(q) * 3 + danger(g, q) * 0.5);
  }
  return argmax(cand, (q) => suspicion(g, p, q) + (g.total(q) / g.threshold(q)) * 0.8);
}
function trusted(g, p, filter = () => true) {
  const cand = g.alive().filter(filter);
  if (!cand.length) return null;
  if (p.witch) return argmax(cand, (q) => (q.witch ? 10 : 0) - (q === p ? 0 : 0.1));
  return argmax(cand, (q) => (q === p ? 5 : -suspicion(g, p, q)));
}

// ═══════════════════ turn ═══════════════════
function turn(g, p, req) {
  const hand = p.hand;
  const find = (type) => hand.find((c) => c.type === type);
  const noPiety = (q) => !g.hasBlue(q, 'piety');
  const myTotal = g.total(p);
  const myTh = g.threshold(p);

  // พลังใช้ครั้งเดียว
  if (!p.used) {
    if (p.char === 'mather' && !(mind(p).peek)) {
      const t = p.witch ? null : mainTarget(g, p);
      if (t && g.hidden(t).length) return { action: 'power', target: t.seat, index: g.hidden(t)[Math.floor(rnd(g) * g.hidden(t).length)] };
    }
    if (p.char === 'jproctor' && myTotal >= myTh - 3 && p.red.some((r) => r.card.type === 'accusation')) {
      const t = mainTarget(g, p, noPiety);
      if (t) return { action: 'power', target: t.seat };
    }
    if (p.char === 'parris') {
      const t = trusted(g, p, (q) => q.red.some((r) => r.card.type === 'accusation') && g.total(q) >= g.threshold(q) - 3);
      if (t) return { action: 'power', target: t.seat };
    }
    if (p.char === 'tituba' && g.deck.length >= 3 && rnd(g) < 0.3) return { action: 'power' };
  }

  // กติกา: ห้ามเล่นการ์ดใส่ตัวเอง — บอทช่วยพวกพ้อง/คนที่ไว้ใจแทน
  const friendOk = (q) => q !== p && (p.witch ? q.witch : suspicion(g, p, q) < 0.8);
  const alibi = find('alibi');
  if (alibi) {
    const friend = trusted(g, p, (q) => q !== p && q.red.some((r) => r.card.type === 'accusation') && g.total(q) >= g.threshold(q) - 3);
    if (friend && friendOk(friend)) return { action: 'play', card: alibi.id, target: friend.seat };
  }
  const goat = find('scapegoat');
  if (goat) {
    // ย้ายการ์ดแดงจากพวกเดียวกันที่ใกล้โดนไต่สวน ไปหาคนที่น่าสงสัยที่สุด
    const from = trusted(g, p, (q) => q !== p && g.total(q) >= g.threshold(q) - 3);
    const to = from && mainTarget(g, p, (q) => q !== from);
    if (from && to && friendOk(from)) return { action: 'play', card: goat.id, target: from.seat, target2: to.seat };
  }
  for (const type of ['asylum', 'piety']) {
    const c = find(type);
    const friend = c && trusted(g, p, (q) => q !== p && !g.hasBlue(q, type) && (type === 'asylum' || g.total(q) >= 2));
    if (friend && friendOk(friend)) return { action: 'play', card: c.id, target: friend.seat };
  }

  // การ์ดแดง
  const reds = hand.filter((c) => CARDS[c.type].color === 'red').sort((a, b) => CARDS[b.type].value - CARDS[a.type].value);
  if (reds.length) {
    const t = mainTarget(g, p, noPiety);
    const worth = t && (p.witch || suspicion(g, p, t) > 0.35 || reds.length >= 3 || rnd(g) < 0.35);
    if (worth) {
      const c = reds.find((x) => x.type !== 'witness') || reds[0];
      const useWitness = reds.find((x) => x.type === 'witness');
      const card = useWitness && (p.witch || suspicion(g, p, t) > 1.2) ? useWitness : c;
      const power = card.type === 'accusation' && p.char === 'abigail' && !p.used && g.total(t) + 3 >= g.threshold(t);
      return { action: 'play', card: card.id, target: t.seat, power };
    }
  }
  const stocks = find('stocks');
  if (stocks) {
    const t = mainTarget(g, p, (q) => q.char !== 'osborne' && !q.stocks.length);
    if (t && (p.witch || suspicion(g, p, t) > 0.8)) return { action: 'play', card: stocks.id, target: t.seat };
  }
  const arson = find('arson');
  if (arson) {
    const t = mainTarget(g, p, (q) => q.char !== 'mcorey' && q.hand.length >= 3);
    if (t) return { action: 'play', card: arson.id, target: t.seat };
  }
  const rob = find('robbery');
  if (rob) {
    const t = argmax(others(g, p).filter((q) => q.char !== 'mcorey' && q.hand.length >= 3 && (!p.witch || !q.witch)), (q) => q.hand.length);
    const to = t && trusted(g, p, (q) => q !== p && q !== t);
    if (t && to) return { action: 'play', card: rob.id, target: t.seat, target2: to.seat };
  }
  const curse = find('curse');
  if (curse) {
    const t = mainTarget(g, p, (q) => q.char !== 'burroughs' && q.blue.some((b) => b.type !== 'matchmaker'));
    if (t) return { action: 'play', card: curse.id, target: t.seat, blue: t.blue.find((b) => b.type !== 'matchmaker').id };
    // แม่มดที่ถือแมวดำเองอยากไล่แมวทิ้ง (ห้ามใช้กับตัวเอง จึงทำได้เฉพาะเมื่อแมวอยู่กับพวกพ้อง)
    const cat = g.catSeat !== null && g.players[g.catSeat];
    if (p.witch && cat && cat !== p && cat.alive && cat.witch && cat.char !== 'burroughs') return { action: 'play', card: curse.id, target: cat.seat, blue: 'cat' };
  }
  const mm = find('matchmaker');
  if (mm) {
    const t = mainTarget(g, p, (q) => !g.hasBlue(q, 'matchmaker'));
    if (t && g.players.some((q) => q.alive && g.hasBlue(q, 'matchmaker') && (p.witch ? !q.witch : true))) {
      return { action: 'play', card: mm.id, target: t.seat };
    }
    if (t && hand.length >= 5) return { action: 'play', card: mm.id, target: t.seat };
  }
  if (req.played) return { action: 'end' };
  return { action: p.char === 'warren' ? 'draw3' : 'draw' };
}

// ═══════════════════ other prompts ═══════════════════
const JUNK = ['matchmaker', 'curse', 'accusation', 'robbery', 'arson', 'stocks', 'asylum', 'evidence', 'scapegoat', 'alibi', 'piety', 'witness'];
function junkFirst(hand) {
  return [...hand].sort((a, b) => JUNK.indexOf(a.type) - JUNK.indexOf(b.type));
}

function decide(g, p, req) {
  const pick = (arr) => arr[Math.floor(rnd(g) * arr.length)];
  switch (req.type) {
    case 'turn': return turn(g, p, req);
    case 'reveal': case 'conspTake': return { index: pick(req.indexes) };
    case 'bribe': {
      const holdsWitch = p.tryal.some((c) => !c.revealed && c.kind === 'w');
      if (!holdsWitch && rnd(g) > 0.6) return { use: false };
      return { use: true, cards: junkFirst(p.hand).slice(0, 2).map((c) => c.id) };
    }
    case 'discard1': return { card: junkFirst(p.hand)[0].id };
    case 'tituba': {
      const ids = req.cards.map((c) => c.id);
      const night = req.cards.find((c) => c.type === 'night');
      if (!night) return { order: ids };
      const rest = ids.filter((id) => id !== night.id);
      return { order: p.witch ? [night.id, ...rest] : [...rest, night.id] };
    }
    case 'witchVote': {
      const opts = req.options.map((s) => g.players[s]);
      if (req.round === 2 && req.prev) {
        const tally = {};
        for (const s of Object.values(req.prev)) tally[s] = (tally[s] || 0) + 1;
        const best = Object.keys(tally).map(Number).sort((a, b) => tally[b] - tally[a] || a - b)[0];
        if (best !== undefined) return { target: best };
      }
      const town = opts.filter((q) => !q.witch && (req.kind === 'cat' || !g.hasBlue(q, 'asylum')));
      const pool = town.length ? town : opts.filter((q) => !q.witch).length ? opts.filter((q) => !q.witch) : opts;
      return { target: argmax(pool, (q) => danger(g, q)).seat };
    }
    case 'protect': {
      const opts = req.options.map((s) => g.players[s]);
      if (p.witch) return { target: argmax(opts, (q) => (q.witch ? 5 : 0) + rnd(g)).seat };
      return { target: argmax(opts, (q) => -suspicion(g, p, q) + q.tryal.filter((c) => c.revealed && c.kind === 'nw').length * 0.4).seat };
    }
    case 'confess': {
      const hid = g.hidden(p);
      if (hid.length < 2) return { index: null };
      const safe = hid.filter((i) => p.tryal[i].kind === 'nw');
      if (!safe.length) return { index: null };
      const chance = p.witch ? 0.3 : hid.length >= 3 ? 0.4 : 0.25;
      return rnd(g) < chance ? { index: pick(safe) } : { index: null };
    }
    default: return null;
  }
}

module.exports = { decide, observe, suspicion, danger, mainTarget };
