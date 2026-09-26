'use strict';

// บทพูดของบอทในแชท (ภาษาไทยสำนวนย้อนยุค) — บอทพูดเฉพาะสิ่งที่ตัวเองควรรู้
// แม่มดโกหกเหมือนชาวเมือง และคุยกันลับ ๆ ในช่องแม่มดตอนกลางคืน

const { CHARACTERS } = require('./cards');
const bot = require('./bot');

const L = {
  defend: [
    'ข้าสาบานต่อพระเจ้า ข้าไม่ใช่แม่มด!',
    '{a} ท่านกล่าวหาข้าเพื่อกลบความผิดของตัวเองหรือเปล่า?',
    'หยุดเถอะ {a} ท่านจะเสียใจเมื่อการ์ดข้าถูกเปิด',
    'ข้าเป็นชาวเมืองธรรมดาคนหนึ่งเท่านั้น…',
    'ทำไมต้องเป็นข้า? {a} ไปดูคนอื่นบ้างสิ',
    'ถ้าข้าเป็นแม่มดจริง ข้าคงไม่นั่งเงียบอยู่แบบนี้หรอก',
  ],
  defendHard: [
    'อย่านะ! อีกนิดเดียวข้าต้องเปิดการ์ดแล้ว ข้าบริสุทธิ์จริง ๆ',
    'ใครมีข้อแก้ตัวช่วยข้าด้วย! ข้าไม่ใช่แม่มด',
    '{a} ท่านกำลังทำให้ผู้บริสุทธิ์ต้องขึ้นศาล!',
  ],
  why: [
    '{t} ทำตัวแปลก ๆ มาตั้งแต่เริ่มเกม',
    'ข้าเห็นแววตาของ {t} แล้วขนลุก',
    '{t} เงียบเกินไป คนบริสุทธิ์ไม่เงียบขนาดนี้',
    'ข้าว่า {t} ต้องมีอะไรซ่อนอยู่แน่',
    'เปิดการ์ดมาเลย {t} ให้ทุกคนได้เห็น',
    'แมวดำชอบวนเวียนแถว {t} นะ ข้าสังเกตอยู่',
  ],
  pile: [
    'ใช่! ข้าก็สงสัย {t} เหมือนกัน',
    'อีกนิดเดียว {t} ก็ต้องเปิดการ์ดแล้ว',
    'เห็นด้วย ข้าไม่ไว้ใจ {t}',
  ],
  doubt: [
    'เดี๋ยวก่อน {a} ทำไมต้องรุม {t} ขนาดนั้น?',
    'ข้าว่า {a} รีบร้อนเกินไปนะ',
  ],
  thank: ['ขอบใจนะ {a} ข้าจะไม่ลืมบุญคุณ', 'อย่างน้อยก็ยังมีคนเชื่อข้า ขอบใจ {a}'],
  whyHelp: ['ทำไม {a} ต้องช่วย {t} ด้วย? พวกเดียวกันหรือ?', 'แปลกนะ {a} รีบปกป้อง {t} เชียว'],
  hostile: ['{a}! ท่านทำอะไรของท่าน', 'จำไว้เลย {a} ข้าจะเอาคืน', 'นี่คือการกลั่นแกล้งกันชัด ๆ'],
  cleared: ['เห็นไหม! ข้าบอกแล้วว่าข้าไม่ใช่แม่มด', 'ทีนี้เชื่อข้าหรือยัง?', 'เสียเวลาไปกับข้าทำไมกัน แม่มดตัวจริงยังลอยนวล'],
  clearedOther: ['อ้าว… {t} ไม่ใช่แม่มดนี่นา', 'งั้นแม่มดก็ยังซ่อนอยู่ในหมู่พวกเรา', 'ใครเป็นคนเริ่มกล่าวหา {t} นะ?'],
  constable: ['ใช่ ข้าคือผู้คุ้มกัน ข้าจะปกป้องพวกท่าน', 'ความลับแตกแล้ว… ข้าคือผู้คุ้มกัน'],
  witchFound: ['เจอตัวแล้ว! {t} เป็นแม่มดจริง ๆ ด้วย', 'ข้าบอกแล้ว! {t} ต้องเป็นแม่มด', 'ขอบคุณพระเจ้า กำจัดแม่มดไปได้หนึ่ง'],
  witchFoundSad: ['โอ้… ไม่อยากเชื่อเลยว่า {t} เป็นแม่มด'],
  died: ['ไม่นะ {t}… ขอให้ไปสู่สุคติ', 'เราเสีย {t} ไปอีกคนแล้ว', '{t} ไม่สมควรตายแบบนี้'],
  morningSafe: ['โล่งอก ไม่มีใครตายคืนนี้', 'ผู้คุ้มกันทำงานได้ดีหรือเปล่านะ?', 'คืนนี้เงียบสงบ… แปลกดี'],
  morningDead: ['ใครทำ! {t} ไม่น่าเป็นแม่มดเลย', 'แม่มดเลือก {t}… แปลว่า {t} คงรู้อะไรบางอย่าง', 'เราต้องหาแม่มดให้เจอก่อนคืนหน้า'],
  nightStart: ['ขอให้รอดถึงเช้า…', 'ข้าจะสวดภาวนาทั้งคืน', 'ทุกคนหลับตา… อย่าแอบดูนะ'],
  conspiracy: ['แมวดำ! ทุกคนระวังการ์ดของตัวเองให้ดี', 'สมรู้ร่วมคิดแล้ว… ใครจะกลายเป็นแม่มดคนต่อไป?'],
  musing: ['ข้าสงสัย {t} อยู่นะ ใครเห็นด้วยบ้าง?', 'ตาข้าแล้ว… {t} ระวังตัวไว้', 'ข้ายังไม่แน่ใจ แต่ {t} ดูมีพิรุธ'],
  winTown: ['เมืองเซเลมปลอดภัยแล้ว!', 'ความยุติธรรมชนะ!'],
  winWitch: ['ฮ่า ๆ ๆ พวกเจ้าไม่มีวันจับข้าได้หรอก', 'ราตรีเป็นของเราแล้ว 🧹'],
  loseTown: ['ไม่อยากเชื่อ… แม่มดชนะ', 'เราพลาดไปตรงไหนกันนะ'],
  loseWitch: ['ชิ! ถูกจับได้จนได้', 'คราวหน้าข้าจะระวังกว่านี้'],
  // ช่องลับของแม่มด
  witchPlan: ['คืนนี้เอา {t} ไหม? ดูอันตรายที่สุด', 'ข้าว่าต้องกำจัด {t} ก่อน', 'เลือก {t} เถอะ เร็วเข้า'],
  witchCat: ['ให้แมวดำ {t} ดีกว่า', 'แมวดำไปหา {t} ละกัน'],
  // ตอบผู้เล่นมนุษย์
  replyAccused: ['ข้าไม่ใช่แม่มด {a}! ท่านต่างหากที่น่าสงสัย', 'หลักฐานของท่านอยู่ไหน {a}?', 'ข้าบริสุทธิ์ใจ {a} ลองดูการ์ดที่ข้าเปิดสิ'],
  replyWho: ['ข้าสงสัย {t} ที่สุด', 'ถ้าให้เดา ข้าว่า {t}', '{t} ยังไม่เคยถูกไต่สวนเลย น่าสนใจนะ'],
  replyClaim: ['ใคร ๆ ก็พูดแบบนั้นแหละ {a}', 'คำพูดพิสูจน์อะไรไม่ได้หรอก {a}', 'ข้าอยากเชื่อท่านนะ {a}'],
  replyHelp: ['ได้ ข้าจะช่วยกล่าวหา {t}', 'ข้าก็มองอยู่ {t} ต้องถูกไต่สวน'],
  replyGeneric: ['หืม? ว่าอย่างไรนะ {a}', 'ข้าฟังอยู่ {a}', 'จริงหรือ {a}?', 'อืม… ข้าจะจำไว้'],
};

const first = (p) => CHARACTERS[p.char].name;

function fill(g, arr, vars) {
  const s = arr[Math.floor(g.rnd() * arr.length)];
  return s.replace(/\{(\w)\}/g, (_, k) => (vars[k] ? first(vars[k]) : ''));
}

const speakers = (g) => g.players.filter((p) => p.isBot && p.alive);
const chance = (g, x) => g.rnd() < x;
function pickBot(g, exclude = []) {
  const list = speakers(g).filter((p) => !exclude.includes(p));
  return list.length ? list[Math.floor(g.rnd() * list.length)] : null;
}
/** คนที่บอทชี้ว่าน่าสงสัย (แม่มดชี้ชาวเมืองเพื่อตบตา) */
function suspectOf(g, p) {
  return bot.mainTarget(g, p);
}

/** เหตุการณ์ในเกม → บทพูดของบอท [{seat, text, scope}] */
function react(g, ev) {
  const out = [];
  const say = (p, arr, vars = {}, scope = 'all') => { if (p) out.push({ seat: p.seat, text: fill(g, arr, vars), scope }); };
  const P = (s) => (s === null || s === undefined ? null : g.players[s]);
  switch (ev.type) {
    case 'accuse': {
      const a = P(ev.from); const t = P(ev.to);
      const hard = g.total(t) >= g.threshold(t) - 2;
      if (t.isBot && t.alive && chance(g, hard ? 0.8 : 0.5)) say(t, hard ? L.defendHard : L.defend, { a });
      else if (a.isBot && chance(g, 0.4)) say(a, L.why, { t });
      const o = pickBot(g, [a, t]);
      if (o && chance(g, 0.18)) say(o, o.witch && !t.witch ? L.pile : chance(g, 0.5) ? L.pile : L.doubt, { a, t });
      break;
    }
    case 'defend': {
      const a = P(ev.from); const t = P(ev.to);
      if (t !== a && t.isBot && t.alive && chance(g, 0.5)) say(t, L.thank, { a });
      const o = pickBot(g, [a, t]);
      if (o && t !== a && chance(g, 0.25)) say(o, L.whyHelp, { a, t });
      break;
    }
    case 'hostile': {
      const a = P(ev.from); const t = P(ev.to);
      if (t.isBot && t.alive && chance(g, 0.5)) say(t, L.hostile, { a });
      break;
    }
    case 'reveal': {
      const t = P(ev.seat);
      if (ev.kind === 'w') {
        const o = pickBot(g, [t]);
        if (o) say(o, o.witch && chance(g, 0.3) ? L.witchFoundSad : L.witchFound, { t });
      } else if (ev.kind === 'c') {
        if (t.isBot && t.alive && chance(g, 0.7)) say(t, L.constable);
      } else if (t.isBot && t.alive && ev.why !== 'สารภาพ' && chance(g, 0.6)) {
        say(t, L.cleared);
      } else if (ev.why !== 'สารภาพ') {
        const o = pickBot(g, [t]);
        if (o && chance(g, 0.4)) say(o, L.clearedOther, { t });
      }
      break;
    }
    case 'death': {
      const t = P(ev.seat);
      if (!ev.witch) {
        const o = pickBot(g, [t]);
        if (o && chance(g, 0.5)) say(o, L.died, { t });
      }
      break;
    }
    case 'nightStart': {
      const o = pickBot(g);
      if (o && chance(g, 0.5)) say(o, L.nightStart);
      const w = speakers(g).find((p) => p.witch);
      const t = w && bot.decide(g, w, { type: 'witchVote', kind: 'kill', round: 1, options: g.alive().map((p) => p.seat) });
      if (w && t) say(w, L.witchPlan, { t: g.players[t.target] }, 'witch');
      break;
    }
    case 'dawn': {
      const w = speakers(g).find((p) => p.witch);
      if (w && ev.cat !== null) say(w, L.witchCat, { t: g.players[ev.cat] }, 'witch');
      break;
    }
    case 'morning': {
      const o = pickBot(g);
      if (!o) break;
      if (ev.victim === null) { if (chance(g, 0.6)) say(o, L.morningSafe); } else say(o, L.morningDead, { t: P(ev.victim) });
      break;
    }
    case 'conspiracy': {
      const o = pickBot(g);
      if (o && chance(g, 0.6)) say(o, L.conspiracy);
      break;
    }
    case 'turn': {
      const p = P(ev.seat);
      if (p.isBot && chance(g, 0.15)) {
        const t = suspectOf(g, p);
        if (t) say(p, L.musing, { t });
      }
      break;
    }
    case 'over': {
      for (const p of g.players.filter((x) => x.isBot)) {
        if (!chance(g, 0.3)) continue;
        const won = ev.winner === 'witch' ? p.witch : ev.winner === 'town' ? !p.witch : false;
        if (ev.winner === 'draw') continue;
        say(p, p.witch ? (won ? L.winWitch : L.loseWitch) : (won ? L.winTown : L.loseTown));
      }
      break;
    }
    default: break;
  }
  return out.slice(0, 2);
}

const norm = (s) => String(s || '').toLowerCase();

/** ผู้เล่นมนุษย์พิมพ์แชท → บอทที่ถูกพูดถึงตอบ */
function reply(g, speaker, text) {
  const out = [];
  if (!g || g.phase === 'over' || g.phase === 'setup') return out;
  const t = norm(text);
  const mentioned = speakers(g).filter((p) => {
    if (p === speaker) return false;
    const full = norm(CHARACTERS[p.char].name);
    const firstWord = full.split(' ')[0];
    return t.includes(full) || (firstWord.length >= 3 && t.includes(firstWord)) || t.includes(norm(p.name));
  });
  const accuseWords = ['แม่มด', 'สงสัย', 'โกหก', 'มีพิรุธ', 'witch'];
  const accusing = accuseWords.some((w) => t.includes(w));
  const vars = { a: speaker };
  if (mentioned.length) {
    const b = mentioned[0];
    if (accusing) out.push({ seat: b.seat, text: fill(g, L.replyAccused, vars) });
    else if (t.includes('ใคร')) out.push({ seat: b.seat, text: fill(g, L.replyWho, { ...vars, t: suspectOf(g, b) || speaker }) });
    else out.push({ seat: b.seat, text: fill(g, L.replyGeneric, vars) });
    return out;
  }
  const b = pickBot(g);
  if (!b) return out;
  if (t.includes('ไม่ใช่แม่มด') && chance(g, 0.6)) out.push({ seat: b.seat, text: fill(g, L.replyClaim, vars) });
  else if (t.includes('ใคร') && chance(g, 0.7)) out.push({ seat: b.seat, text: fill(g, L.replyWho, { ...vars, t: suspectOf(g, b) || speaker }) });
  else if ((t.includes('ช่วย') || t.includes('กล่าวหา')) && chance(g, 0.5)) {
    const tgt = suspectOf(g, b);
    if (tgt && tgt !== b) out.push({ seat: b.seat, text: fill(g, L.replyHelp, { ...vars, t: tgt }) });
  } else if (accusing && chance(g, 0.4)) {
    const tgt = suspectOf(g, b);
    if (tgt) out.push({ seat: b.seat, text: fill(g, L.replyWho, { ...vars, t: tgt }) });
  }
  return out;
}

module.exports = { react, reply, LINES: L };
