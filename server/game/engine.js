'use strict';

// เครื่องยนต์เกม เซเลม 1692 — เซิร์ฟเวอร์เป็นผู้ตัดสินทั้งหมด
// ทุกการตัดสินใจของผู้เล่นคือ prompt ที่ await (async state machine) ผู้เล่นที่หลุดกลับมาตอบ prompt เดิมต่อได้

const { CARDS, TRYALS, CHARACTERS, DECK_SIZE, buildDeck, buildTryals } = require('./cards');
const bot = require('./bot');

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;
const THRESHOLD = 7;

const PHASE_NAMES = {
  setup: 'เตรียมเกม', dawn: 'รุ่งอรุณ', day: 'กลางวัน', night: 'ยามราตรี', confess: 'สารภาพ',
  conspiracy: 'สมรู้ร่วมคิด', over: 'จบเกม',
};

class GameOver extends Error {
  constructor(result) { super('game over'); this.result = result; }
}
class GameAborted extends Error {
  constructor() { super('game aborted'); }
}

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const uniq = (arr) => new Set(arr).size === arr.length;
const cardOut = (c) => (c ? { id: c.id, type: c.type } : null);

class Game {
  /**
   * @param {object} o
   * @param {{pid:string,name:string,isBot?:boolean}[]} o.players ลำดับที่นั่ง (ตามเข็มนาฬิกา = ลำดับการเล่น)
   * @param {Function} [o.onUpdate] เรียกทุกครั้งที่สถานะเปลี่ยน
   * @param {Function} [o.onEvent] เหตุการณ์สาธารณะ (ใช้ให้บอทคุยในแชท)
   * @param {number} [o.botDelay] หน่วงเวลาบอท (ms)
   * @param {object} [o.timeouts] { turn, quick, disconnected } (ms)
   * @param {number} [o.maxTurns] จำกัดจำนวนตา (กันเกมยาวไม่รู้จบ) 0 = ไม่จำกัด
   * @param {Function} [o.rng] ตัวสุ่ม (ค่าเริ่มต้น Math.random)
   * @param {Function} [o.rig] ปรับสถานะหลังแจกไพ่ (ใช้ในการทดสอบ)
   * @param {number} [o.firstSeat]
   */
  constructor(o) {
    const n = o.players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`จำนวนผู้เล่นต้องอยู่ระหว่าง ${MIN_PLAYERS}-${MAX_PLAYERS} คน`);
    this.rnd = o.rng || Math.random;
    this.onUpdate = o.onUpdate || (() => {});
    this.onEvent = o.onEvent || (() => {});
    this.botDelay = o.botDelay ?? 2500;
    this.pace = o.pace ?? 0; // ตัวคูณเวลาหยุดให้ดูเหตุการณ์ (ห้องจริงใช้ 1)
    this.beatMs = 0;
    this.sleepTimers = new Set();
    this.timeouts = { turn: 60000, quick: 20000, disconnected: 12000, ...(o.timeouts || {}) };
    this.maxTurns = o.maxTurns ?? 600;
    const chars = shuffle(Object.keys(CHARACTERS), this.rnd);
    this.players = o.players.map((p, i) => ({
      pid: p.pid, name: p.name, isBot: !!p.isBot, connected: true, seat: i,
      char: chars[i], alive: true, witch: false, tryal: [], hand: [], red: [], blue: [],
      stocks: [], used: false, notes: [], mind: {},
    }));
    // การ์ดไต่สวน
    const kinds = shuffle(buildTryals(n), this.rnd);
    let tid = 0;
    const per = kinds.length / n;
    this.players.forEach((p, i) => {
      p.tryal = kinds.slice(i * per, (i + 1) * per).map((kind) => ({ id: ++tid, kind, revealed: false }));
    });
    // สำรับ: แจก 3 ใบ แล้วใส่ "สมรู้ร่วมคิด" ตำแหน่งสุ่ม และ "ราตรี" ในส่วนล่างของกอง (ท้ายอาร์เรย์ = บนสุด)
    const all = buildDeck();
    this.cardById = new Map(all.map((c) => [c.id, c]));
    const night = all.find((c) => c.type === 'night');
    const consp = all.find((c) => c.type === 'conspiracy');
    this.deck = shuffle(all.filter((c) => c !== night && c !== consp), this.rnd);
    for (const p of this.players) p.hand = this.deck.splice(-3, 3);
    this.deck.splice(Math.floor(this.rnd() * (this.deck.length + 1)), 0, consp);
    this.deck.unshift(night); // ราตรีอยู่ใบล่างสุดเสมอ (ท้ายอาร์เรย์ = บนสุด)
    this.discard = [];
    this.queue = []; // การ์ดดำที่จั่วได้ระหว่างเหตุการณ์อื่น รอเกิดผลเมื่อปลอดภัย
    this.owed = []; // การ์ดที่ยังจั่วไม่ครบเพราะเจอราตรีกลางคัน
    this.catSeat = null;
    this.ballot = null; // การลงคะแนนของแม่มด (เห็นเฉพาะแม่มด)
    this.pending = new Map();
    this.promptSeq = 0;
    this.logs = [];
    this.logSeq = 0;
    this.events = []; // สำหรับวาดลูกศร
    this.eventSeq = 0;
    this.turnNo = 0;
    this.nightNo = 0;
    this.phase = 'setup';
    this.fixedFirst = o.firstSeat; // ปกติผู้ถือแมวดำเริ่มก่อน (กำหนดตายตัวได้เพื่อการทดสอบ)
    this.firstSeat = o.firstSeat ?? 0;
    this.gavelSeat = null; // ค้อนของผู้คุ้มกัน (ทุกคนเห็นหลังราตรี)
    this.activeSeat = null;
    this.result = null;
    this.aborted = false;
    if (o.rig) o.rig(this);
    this.syncWitches();
  }

  // ════════════════════════════ utilities ════════════════════════════

  update() { this.onUpdate(); }
  emit(ev) {
    try { bot.observe(this, ev); this.onEvent(ev); } catch (e) { console.error('event hook error', e); }
  }

  log(text, silent = false) {
    this.logs.push({ id: ++this.logSeq, text });
    if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
    if (!silent) this.update();
  }
  note(p, text) {
    p.notes.push({ id: ++this.logSeq, text });
    if (p.notes.length > 30) p.notes.shift();
  }
  /**
   * เหตุการณ์สาธารณะที่แสดงบนแถบ "เกิดอะไรขึ้น" (พร้อมลูกศร/แอนิเมชันถ้ามีผู้กระทำและเป้าหมาย)
   * ms = เวลาที่ทุกคนควรได้เห็นเหตุการณ์นี้ก่อนเกมเดินต่อ (สะสมไว้ แล้วรอจริงใน settle)
   */
  feed(text, o = {}) {
    const ms = o.ms ?? 2500;
    this.events.push({
      id: ++this.eventSeq, turn: this.turnNo, at: Date.now(), text, ms,
      from: o.from ?? null, to: o.to || [], card: o.card || null, value: o.value ?? null, art: o.art || null, kind: o.kind || null,
    });
    if (this.events.length > 20) this.events.shift();
    this.beatMs += ms;
    this.log(text, !!o.silent);
  }
  /** หยุดรอให้ทุกคนเห็นเหตุการณ์ที่เพิ่งเกิด (pace 0 = ไม่รอ ใช้ในการทดสอบ) คืนเวลาที่รอ (ms) */
  async settle() {
    const ms = this.beatMs * this.pace;
    this.beatMs = 0;
    if (ms > 0) await new Promise((r) => { const t = setTimeout(r, ms); this.sleepTimers.add(t); });
    if (this.aborted) throw new GameAborted();
    return ms;
  }

  player(pid) { return this.players.find((p) => p.pid === pid); }
  nm(p) { return CHARACTERS[p.char].name; }
  alive() { return this.players.filter((p) => p.alive); }
  hidden(p) { return p.tryal.map((c, i) => (c.revealed ? -1 : i)).filter((i) => i >= 0); }
  total(p) { return p.red.reduce((s, r) => s + r.value, 0); }
  threshold(p) { return p.char === 'gcorey' ? 8 : THRESHOLD; }
  hasBlue(p, type) { return p.blue.some((c) => c.type === type); }
  nextAlive(p) {
    const n = this.players.length;
    for (let i = 1; i < n; i++) {
      const q = this.players[(p.seat + i) % n];
      if (q.alive) return q;
    }
    return null;
  }
  /** ผู้คุ้มกัน = ผู้ที่ถือการ์ดผู้คุ้มกันที่ยังคว่ำอยู่ (ถ้าการ์ดถูกเปิด บทบาทนี้หายไปจากเกม) */
  constable() { return this.players.find((p) => p.alive && p.tryal.some((c) => c.kind === 'c' && !c.revealed)) || null; }
  /** ใครเคยถือการ์ดแม่มด = แม่มดตลอดเกม */
  syncWitches() { for (const p of this.players) if (p.tryal.some((c) => c.kind === 'w')) p.witch = true; }

  drawOne() {
    if (!this.deck.length) {
      if (!this.discard.length) return null;
      this.deck = shuffle(this.discard, this.rnd);
      this.discard = [];
      this.log('กองจั่วหมด สับกองทิ้งเป็นกองจั่วใหม่');
    }
    return this.deck.pop() || null;
  }
  /** จั่วการ์ด n ใบ การ์ดดำเข้าคิวรอเกิดผล คืน true ถ้าจั่วได้ "ราตรี" (หยุดจั่วทันที) */
  draw(p, n, reason = '') {
    let got = 0;
    let guard = 0;
    for (let i = 0; i < n; i++) {
      const c = this.drawOne();
      if (!c) break;
      if (CARDS[c.type].color === 'black') {
        this.discard.push(c);
        this.queue.push({ type: c.type, by: p.seat });
        this.feed(`${this.nm(p)} จั่วได้การ์ด「${CARDS[c.type].name}」!`, { from: p.seat, art: ['cards', c.type], ms: 2000, kind: 'black' });
        // การ์ดดำนับเป็น 1 ใบที่จั่ว; ถ้าเป็นราตรี จั่วใบที่เหลือหลังราตรีจบ
        if (c.type === 'night') { if (i + 1 < n) this.owed.push({ seat: p.seat, n: n - i - 1, reason }); break; }
        continue;
      }
      // เหลือผู้เล่น 2 คน: การ์ดน้ำเงินถูกวางแยกไว้ แล้วจั่วใบใหม่แทน
      if (CARDS[c.type].color === 'blue' && this.alive().length <= 2 && guard++ < 60) {
        this.discard.push(c);
        i--;
        continue;
      }
      p.hand.push(c);
      got++;
    }
    if (got) this.feed(`${this.nm(p)} จั่วการ์ด ${got} ใบ${reason}`, { from: p.seat, art: ['misc', 'back'], ms: 1200, kind: 'draw' });
    return got;
  }
  /** ให้การ์ดดำที่ค้างอยู่เกิดผลตามลำดับ */
  async flush() {
    while (this.queue.length || this.owed.length) {
      if (!this.queue.length) {
        const o = this.owed.shift();
        const p = this.players[o.seat];
        if (p.alive) { this.draw(p, o.n, o.reason); await this.settle(); }
        continue;
      }
      const q = this.queue.shift();
      const by = this.players[q.by];
      if (q.type === 'night') await this.night();
      else await this.conspiracy(by.alive ? by : this.players[this.activeSeat] || by);
    }
  }
  toDiscard(cards) { for (const c of cards) if (c) this.discard.push(c); }

  // ════════════════════════════ prompts ════════════════════════════

  ask(p, req) {
    if (this.aborted) return Promise.reject(new GameAborted());
    const old = this.pending.get(p.pid);
    if (old) old.finish(null);
    return new Promise((resolve, reject) => {
      const id = ++this.promptSeq;
      req.id = id;
      const tmo = Math.max(500, req.type === 'turn' ? this.timeouts.turn : this.timeouts.quick);
      req.deadline = req.deadline || Date.now() + tmo;
      const entry = { id, p, req, timers: [], reject };
      entry.finish = (raw) => {
        if (this.pending.get(p.pid) !== entry) return;
        entry.timers.forEach(clearTimeout);
        this.pending.delete(p.pid);
        let ans = raw ? this.normalize(p, req, raw) : null;
        if (!ans) ans = this.normalize(p, req, this.fallback(p, req));
        this.update();
        resolve(ans);
      };
      this.pending.set(p.pid, entry);
      if (p.isBot) {
        this.scheduleBot(entry);
      } else {
        entry.timers.push(setTimeout(() => entry.finish(this.timeoutAnswer(p, req)), Math.max(0, req.deadline - Date.now())));
        if (!p.connected) this.addDisconnectTimer(entry);
      }
      this.update();
    });
  }
  scheduleBot(entry) {
    const run = () => entry.finish(this.botAnswer(entry.p, entry.req));
    if (!this.botDelay) { setImmediate(run); return; }
    const k = entry.req.type === 'turn' && entry.req.played ? 0.6 : 1;
    entry.timers.push(setTimeout(run, this.botDelay * k * (0.8 + this.rnd() * 0.4)));
  }
  addDisconnectTimer(entry) {
    clearTimeout(entry.dcTimer);
    entry.dcTimer = setTimeout(() => entry.finish(this.botAnswer(entry.p, entry.req)), this.timeouts.disconnected);
    entry.timers.push(entry.dcTimer);
  }
  botAnswer(p, req) {
    try { return bot.decide(this, p, req); } catch (e) { console.error('bot error', e); return null; }
  }
  timeoutAnswer(p, req) {
    if (req.type === 'turn') return { action: req.played ? 'end' : 'draw' };
    if (req.type === 'confess') return { index: null };
    if (req.type === 'bribe') return { use: false };
    return this.botAnswer(p, req);
  }
  /** คำตอบสำรองที่ถูกต้องเสมอ */
  fallback(p, req) {
    switch (req.type) {
      case 'turn': return { action: req.played ? 'end' : 'draw' };
      case 'reveal': case 'conspTake': return { index: req.indexes[0] };
      case 'witchVote': case 'protect': return { target: req.options[0] };
      case 'confess': return { index: null };
      case 'bribe': return { use: false };
      case 'discard1': return { card: p.hand[0] && p.hand[0].id };
      case 'tituba': return { order: req.cards.map((c) => c.id) };
      default: return null;
    }
  }

  /** ตรวจคำตอบ คืนคำตอบที่ถูกต้องแล้ว หรือ null */
  normalize(p, req, a) {
    if (!a || typeof a !== 'object') return null;
    const inHand = (id) => p.hand.some((c) => c.id === id);
    switch (req.type) {
      case 'turn': return this.checkTurn(p, req, a);
      case 'reveal': case 'conspTake':
        return Number.isInteger(a.index) && req.indexes.includes(a.index) && !this.players[req.target].tryal[a.index].revealed ? { index: a.index } : null;
      case 'witchVote': case 'protect':
        return Number.isInteger(a.target) && req.options.includes(a.target) ? { target: a.target } : null;
      case 'confess':
        if (a.index === null || a.index === undefined) return { index: null };
        return Number.isInteger(a.index) && p.tryal[a.index] && !p.tryal[a.index].revealed ? { index: a.index } : null;
      case 'bribe':
        if (!a.use) return { use: false };
        return Array.isArray(a.cards) && a.cards.length === 2 && uniq(a.cards) && a.cards.every(inHand) ? { use: true, cards: a.cards } : null;
      case 'discard1':
        return Number.isInteger(a.card) && inHand(a.card) ? { card: a.card } : null;
      case 'tituba': {
        const ids = req.cards.map((c) => c.id);
        const o = Array.isArray(a.order) ? a.order : null;
        return o && o.length === ids.length && uniq(o) && o.every((id) => ids.includes(id)) ? { order: o } : null;
      }
      default: return null;
    }
  }

  /** ตรวจการกระทำในตาของผู้เล่น */
  checkTurn(p, req, a) {
    if (a.action === 'end') return req.played || !this.canDraw(p, req) ? { action: 'end' } : null;
    if (a.action === 'draw') return !req.played ? { action: 'draw' } : null;
    if (a.action === 'draw3') return !req.played && p.char === 'warren' ? { action: 'draw3' } : null;
    if (a.action === 'power') return this.checkPower(p, a);
    if (a.action !== 'play') return null;
    const card = Number.isInteger(a.card) && p.hand.find((c) => c.id === a.card);
    if (!card) return null;
    const def = CARDS[card.type];
    const T = (s) => (Number.isInteger(s) && this.players[s] && this.players[s].alive ? this.players[s] : null);
    const t = T(a.target);
    // กติกา: ห้ามเล่นการ์ดใส่ตัวเองเด็ดขาด (ทั้งเป้าหมายแรกและเป้าหมายที่สอง)
    if (!t || t === p) return null;
    if (def.color === 'red') {
      if (!t || t === p || this.hasBlue(t, 'piety')) return null;
      const power = !!a.power;
      if (power && !(card.type === 'accusation' && p.char === 'abigail' && !p.used)) return null;
      return { action: 'play', card, target: t, power };
    }
    switch (card.type) {
      case 'stocks':
        return t && t !== p && t.char !== 'osborne' ? { action: 'play', card, target: t } : null;
      case 'arson':
        return t && t !== p && t.char !== 'mcorey' ? { action: 'play', card, target: t } : null;
      case 'alibi':
        return { action: 'play', card, target: t };
      case 'matchmaker':
        return { action: 'play', card, target: t }; // แม่สื่อ 2 ใบที่คนเดียวกันจะถูกทิ้งทั้งคู่
      case 'asylum': case 'piety':
        return !this.hasBlue(t, card.type) ? { action: 'play', card, target: t } : null;
      case 'scapegoat': {
        const t2 = T(a.target2);
        return t2 && t2 !== p && t !== t2 ? { action: 'play', card, target: t, target2: t2 } : null;
      }
      case 'robbery': {
        const t2 = T(a.target2);
        return t2 && t2 !== p && t !== t2 && t.char !== 'mcorey' ? { action: 'play', card, target: t, target2: t2 } : null;
      }
      case 'curse': {
        if (t.char === 'burroughs') return null;
        if (a.blue === 'cat') return this.catSeat === t.seat ? { action: 'play', card, target: t, blue: 'cat' } : null; // แมวดำนับเป็นการ์ดสีน้ำเงิน
        const b = t.blue.find((c) => c.id === a.blue);
        return b ? { action: 'play', card, target: t, blue: b } : null;
      }
      default: return null;
    }
  }
  canDraw() { return true; }
  checkPower(p, a) {
    if (p.used) return null;
    const t = Number.isInteger(a.target) && this.players[a.target];
    switch (p.char) {
      case 'mather':
        return t && t !== p && t.alive && Number.isInteger(a.index) && t.tryal[a.index] && !t.tryal[a.index].revealed
          ? { action: 'power', target: t, index: a.index } : null;
      case 'jproctor':
        return t && t !== p && t.alive && !this.hasBlue(t, 'piety') && p.red.some((r) => r.card.type === 'accusation')
          ? { action: 'power', target: t } : null;
      case 'parris':
        return t && t.alive && t.red.some((r) => r.card.type === 'accusation') ? { action: 'power', target: t } : null;
      case 'tituba':
        return this.deck.length ? { action: 'power' } : null;
      default: return null;
    }
  }

  /** คำตอบจากไคลเอนต์ — คืนข้อความ error ถ้าไม่ถูกต้อง */
  submit(pid, promptId, data) {
    const entry = this.pending.get(pid);
    if (!entry || entry.id !== promptId) return 'คำสั่งนี้หมดอายุแล้ว';
    if (!this.normalize(entry.p, entry.req, data)) return 'การเลือกไม่ถูกต้อง';
    entry.finish(data);
    return null;
  }

  // ════════════════════════════ main flow ════════════════════════════

  async run() {
    try {
      this.log(`เริ่มเกม! ผู้เล่น ${this.players.length} คน · การ์ดไต่สวนคนละ ${this.players[0].tryal.length} ใบ · การ์ด ${DECK_SIZE} ใบ`);
      await this.dawn();
      let seat = this.firstSeat;
      for (;;) {
        const p = this.players[seat];
        if (p.alive) {
          this.turnNo++;
          if (this.maxTurns && this.turnNo > this.maxTurns) throw new GameOver(this.makeResult('draw', 'ครบจำนวนตาสูงสุด เกมจบลงโดยไม่มีผู้ชนะ'));
          await this.takeTurn(p);
          await this.flush();
        }
        seat = (seat + 1) % this.players.length;
      }
    } catch (e) {
      if (e instanceof GameOver) this.finish(e.result);
      else if (e instanceof GameAborted) { /* ถูกยกเลิก */ } else {
        console.error('game engine error', e);
        this.finish(this.makeResult('draw', 'เกมสิ้นสุดเนื่องจากข้อผิดพลาดของระบบ'));
      }
    }
    return this.result;
  }

  /** แม่มดตกลงเลือกผู้เล่น 1 คน: รอบแรกเลือกพร้อมกัน ถ้าไม่ตรงกันมีรอบสอง (เห็นตัวเลือกของกันและกัน) แล้วใช้เสียงข้างมาก */
  async witchVote(kind) {
    const witches = this.alive().filter((p) => p.witch);
    if (!witches.length) return null;
    const options = this.alive().map((p) => p.seat);
    const rounds = witches.length > 1 ? 2 : 1;
    let votes = {};
    for (let round = 1; round <= rounds; round++) {
      const prev = votes;
      votes = {};
      this.ballot = { kind, round, votes, prev };
      const deadline = Date.now() + this.timeouts.quick;
      await Promise.all(witches.map(async (w) => {
        const a = await this.ask(w, { type: 'witchVote', kind, round, options, prev, deadline });
        votes[w.seat] = a.target;
        this.update();
      }));
      if (new Set(Object.values(votes)).size === 1) break;
    }
    this.ballot = null;
    const tally = new Map();
    for (const s of Object.values(votes)) tally.set(s, (tally.get(s) || 0) + 1);
    const best = Math.max(...tally.values());
    const tops = [...tally.keys()].filter((s) => tally.get(s) === best);
    const pick = tops[Math.floor(this.rnd() * tops.length)];
    for (const w of witches) this.note(w, `แม่มดเลือก ${this.nm(this.players[pick])}${kind === 'cat' ? ' ให้ถือแมวดำ' : ' เป็นเหยื่อคืนนี้'}`);
    return pick;
  }

  async dawn() {
    this.phase = 'dawn';
    this.log('🌅 รุ่งอรุณ: แม่มดลืมตาในความมืด มองเห็นกันและกัน แล้วเลือกผู้ถือแมวดำ…');
    const seat = await this.witchVote('cat');
    this.catSeat = seat;
    if (this.fixedFirst === undefined) this.firstSeat = seat;
    this.feed(`🐈‍⬛ แม่มดมอบแมวดำให้ ${this.nm(this.players[seat])} — ${this.nm(this.players[this.firstSeat])} เริ่มเล่นก่อน`, { to: [seat], art: ['misc', 'cat'], kind: 'cat' });
    await this.settle();
    this.phase = 'day';
    this.emit({ type: 'dawn', cat: seat });
  }

  async takeTurn(p) {
    this.activeSeat = p.seat;
    this.phase = 'day';
    if (p.stocks.length) {
      this.toDiscard([p.stocks.shift()]); // ข้ามตาแล้วค่อยทิ้งขื่อคา
      this.feed(`⛓ ${this.nm(p)} ติดขื่อคา ต้องข้ามตานี้${p.stocks.length ? ` (เหลืออีก ${p.stocks.length})` : ''}`, { to: [p.seat], art: ['cards', 'stocks'], ms: 1800 });
      await this.settle();
      return;
    }
    this.emit({ type: 'turn', seat: p.seat });
    let deadline = Date.now() + this.timeouts.turn;
    let played = false;
    while (p.alive) {
      const a = await this.ask(p, { type: 'turn', played, deadline });
      if (a.action === 'end') break;
      if (a.action === 'draw') { this.draw(p, 2); await this.settle(); await this.flush(); break; }
      if (a.action === 'draw3') {
        this.draw(p, 3, ' (พลังแมรี)');
        if (p.hand.length) {
          const d = await this.ask(p, { type: 'discard1' });
          const c = p.hand.find((x) => x.id === d.card);
          p.hand = p.hand.filter((x) => x !== c);
          this.toDiscard([c]);
          this.log(`${this.nm(p)} ทิ้งการ์ด 1 ใบ`);
        }
        await this.settle();
        break;
      }
      if (a.action === 'power') await this.usePower(p, a);
      else { played = true; await this.playCard(p, a); }
      deadline += await this.settle(); // เวลาที่หยุดให้ดูไม่นับเป็นเวลาคิดของผู้เล่น
      await this.flush();
      if (played && !p.hand.length && (p.used || CHARACTERS[p.char].kind !== 'once')) break;
    }
    this.activeSeat = p.seat;
  }

  // ════════════════════════════ cards ════════════════════════════

  async playCard(p, a) {
    const { card, target: t } = a;
    p.hand = p.hand.filter((c) => c !== card);
    const def = CARDS[card.type];
    const who = this.nm(p);
    if (def.color === 'red') {
      let value = def.value;
      if (a.power) { value = 3; p.used = true; }
      t.red.push({ card, value });
      this.feed(`${who} เล่น「${def.name}」ใส่ ${this.nm(t)}${a.power ? ' (เสียงกรีดร้อง นับ 3)' : ''} — กล่าวหา ${this.total(t)}/${this.threshold(t)}`, { from: p.seat, to: [t.seat], card: card.type, value });
      this.emit({ type: 'accuse', from: p.seat, to: t.seat, card: card.type, total: this.total(t) });
      if (card.type === 'evidence' && p.char === 'putnam') this.draw(p, 1, ' (พลังแอนน์)');
      await this.checkAccuse(t, p);
      return;
    }
    const other = a.target2;
    if (def.color === 'green') this.discard.push(card); // ใช้แล้วทิ้งทันที
    switch (card.type) {
      case 'alibi': {
        const n = this.removeAccusations(t, 3);
        this.feed(`${who} เล่น「ข้อแก้ตัว」ให้ ${this.nm(t)} — ทิ้งการ์ดกล่าวหา ${n} ใบ (${this.total(t)}/${this.threshold(t)})`, { from: p.seat, to: [t.seat], card: card.type });
        this.emit({ type: 'defend', from: p.seat, to: t.seat });
        break;
      }
      case 'stocks':
        this.discard.pop(); // ขื่อคาไม่ถูกทิ้งทันที แต่ค้างอยู่หน้าเป้าหมายจนกว่าจะถูกข้ามตา
        t.stocks.push(card);
        this.feed(`${who} ใส่「ขื่อคา」${this.nm(t)} — ต้องข้ามตาถัดไป`, { from: p.seat, to: [t.seat], card: card.type });
        this.emit({ type: 'hostile', from: p.seat, to: t.seat, card: card.type });
        break;
      case 'arson': {
        const n = t.hand.length;
        this.toDiscard(t.hand);
        t.hand = [];
        this.feed(`${who}「วางเพลิง」บ้าน ${this.nm(t)} — ทิ้งการ์ดในมือ ${n} ใบ`, { from: p.seat, to: [t.seat], card: card.type });
        this.emit({ type: 'hostile', from: p.seat, to: t.seat, card: card.type });
        break;
      }
      case 'robbery': {
        const n = t.hand.length;
        other.hand.push(...t.hand);
        t.hand = [];
        this.feed(`${who}「ปล้น」การ์ด ${n} ใบจาก ${this.nm(t)} ไปให้ ${this.nm(other)}`, { from: p.seat, to: [t.seat, other.seat], card: card.type });
        this.emit({ type: 'hostile', from: p.seat, to: t.seat, card: card.type });
        break;
      }
      case 'scapegoat': {
        const moveBlue = t.char !== 'burroughs';
        const reds = t.red.length;
        const blues = moveBlue ? t.blue.length : 0;
        other.red.push(...t.red);
        t.red = [];
        const catMoves = moveBlue && this.catSeat === t.seat;
        if (catMoves) this.catSeat = other.seat;
        if (moveBlue) {
          const moving = t.blue;
          t.blue = [];
          for (const b of moving) this.placeBlue(other, b);
        }
        other.stocks.push(...t.stocks);
        t.stocks = [];
        this.feed(`${who} ใช้「แพะรับบาป」ย้ายการ์ดแดง ${reds} ใบ${blues ? ` และน้ำเงิน ${blues} ใบ` : ''}${catMoves ? ' และแมวดำ' : ''} จาก ${this.nm(t)} ไปหา ${this.nm(other)} (${this.total(other)}/${this.threshold(other)})`, { from: p.seat, to: [t.seat, other.seat], card: card.type });
        this.emit({ type: 'accuse', from: p.seat, to: other.seat, card: card.type, total: this.total(other) });
        await this.checkAccuse(other, p);
        return;
      }
      case 'curse': {
        if (a.blue === 'cat') {
          this.catSeat = null;
          this.feed(`${who} ใช้「คำสาป」ไล่แมวดำหน้า ${this.nm(t)} ออกจากเกม`, { from: p.seat, to: [t.seat], card: card.type });
          this.emit({ type: 'hostile', from: p.seat, to: t.seat, card: card.type });
          break;
        }
        t.blue = t.blue.filter((c) => c !== a.blue);
        this.toDiscard([a.blue]);
        this.feed(`${who} ใช้「คำสาป」ทำลาย「${CARDS[a.blue.type].name}」หน้า ${this.nm(t)}`, { from: p.seat, to: [t.seat], card: card.type });
        this.emit({ type: 'hostile', from: p.seat, to: t.seat, card: card.type });
        break;
      }
      case 'asylum': case 'piety': case 'matchmaker':
        this.placeBlue(t, card);
        this.feed(`${who} วาง「${def.name}」หน้า ${t === p ? 'ตัวเอง' : this.nm(t)}`, { from: p.seat, to: [t.seat], card: card.type });
        this.update();
        return;
      default: break;
    }
    this.update();
  }

  /** วางการ์ดน้ำเงินหน้าผู้เล่น: ซ้ำชนิดเดิมถูกทิ้ง และแม่สื่อ 2 ใบที่คนเดียวกันถูกทิ้งทั้งคู่ */
  placeBlue(t, b) {
    const same = t.blue.find((x) => x.type === b.type);
    if (!same) { t.blue.push(b); return; }
    if (b.type === 'matchmaker') {
      t.blue = t.blue.filter((x) => x !== same);
      this.toDiscard([same, b]);
      this.log(`💔 แม่สื่อ 2 ใบอยู่ที่ ${this.nm(t)} คนเดียว — ทิ้งทั้งคู่`);
    } else this.toDiscard([b]);
  }

  removeAccusations(t, max) {
    let n = 0;
    t.red = t.red.filter((r) => {
      if (n < max && r.card.type === 'accusation') { this.discard.push(r.card); n++; return false; }
      return true;
    });
    return n;
  }

  /** แต้มกล่าวหาถึงเกณฑ์: ผู้ที่ทำให้ครบเลือกการ์ดที่คว่ำอยู่ให้เปิด */
  async checkAccuse(t, chooser) {
    if (!t.alive || this.total(t) < this.threshold(t)) return;
    const who = this.nm(t);
    const discardRed = () => { this.toDiscard(t.red.map((r) => r.card)); t.red = []; };
    if (t.char === 'bishop' && !t.used && t.hand.length >= 2) {
      const b = await this.ask(t, { type: 'bribe' });
      if (b.use) {
        t.used = true;
        const cards = t.hand.filter((c) => b.cards.includes(c.id));
        t.hand = t.hand.filter((c) => !b.cards.includes(c.id));
        this.toDiscard(cards);
        discardRed();
        this.feed(`💰 ${who} ติดสินบนศาล ทิ้งการ์ด 2 ใบแทนการเปิดการ์ดไต่สวน`, { to: [t.seat], art: ['chars', 'bishop'] });
        this.update();
        return;
      }
    }
    this.feed(`⚖ ${who} ถูกกล่าวหาครบ ${this.threshold(t)} แต้ม! ${this.nm(chooser)} เลือกการ์ดไต่สวนให้เปิด`, { to: [t.seat], art: ['misc', 'tryalback'], ms: 1500, kind: 'trial' });
    await this.settle();
    const idxs = this.hidden(t);
    const r = chooser.alive
      ? await this.ask(chooser, { type: 'reveal', target: t.seat, indexes: idxs, why: 'accuse' })
      : { index: idxs[Math.floor(this.rnd() * idxs.length)] };
    discardRed();
    const kind = this.reveal(t, r.index, 'ถูกไต่สวน');
    await this.settle();
    if (kind === 'nw' && t.char === 'good' && chooser.alive && chooser !== t) {
      const i = this.discard.findIndex((c) => c.type === 'accusation');
      if (i >= 0 && !this.hasBlue(chooser, 'piety')) {
        const [c] = this.discard.splice(i, 1);
        chooser.red.push({ card: c, value: 1 });
        this.feed(`🕯 คำแช่งของ ${who}: ${this.nm(chooser)} ได้รับการกล่าวหา 1 แต้ม`, { from: t.seat, to: [chooser.seat], card: 'accusation', value: 1 });
        await this.settle();
        await this.checkAccuse(chooser, t);
      }
    }
    this.checkWin();
  }

  /** เปิดการ์ดไต่สวน 1 ใบ (ถ้าเป็นแม่มดหรือเปิดหมดแล้ว = ตาย) */
  reveal(p, index, why) {
    const c = p.tryal[index];
    c.revealed = true;
    this.feed(`🂠 ${this.nm(p)} ${why} เปิดการ์ด: ${c.kind === 'w' ? '☠ แม่มด!' : TRYALS[c.kind].name}`, { to: [p.seat], art: ['tryal', c.kind], ms: why === 'สารภาพ' ? 2500 : 3500, kind: 'reveal', silent: true });
    this.emit({ type: 'reveal', seat: p.seat, kind: c.kind, why });
    if (c.kind === 'w') this.kill(p, 'ถูกเปิดโปงว่าเป็นแม่มด');
    else if (!this.hidden(p).length) this.kill(p, 'การ์ดไต่สวนถูกเปิดหมด');
    this.update();
    return c.kind;
  }

  /** ผู้เล่นตาย: เปิดการ์ดทั้งหมด ทิ้งมือและการ์ดหน้าตัว */
  kill(p, why) {
    if (!p.alive) return;
    p.alive = false;
    this.toDiscard(p.stocks);
    p.stocks = [];
    for (const c of p.tryal) c.revealed = true;
    this.toDiscard(p.hand);
    this.toDiscard(p.red.map((r) => r.card));
    this.toDiscard(p.blue);
    p.hand = []; p.red = []; p.blue = [];
    const role = p.tryal.some((c) => c.kind === 'w') ? 'แม่มด' : p.witch ? 'แม่มด (เคยถือการ์ดแม่มด)' : 'ชาวเมือง';
    this.feed(`💀 ${this.nm(p)} ตาย (${why}) — เป็น${role}`, { to: [p.seat], art: ['chars', p.char], ms: 3500, kind: 'death' });
    this.emit({ type: 'death', seat: p.seat, witch: p.witch });
    for (const q of this.alive()) if (q.char === 'eproctor') this.draw(q, 1, ' (พลังเอลิซาเบธ)');
    const alive = this.alive();
    if (alive.length === 2 && (alive.some((q) => q.blue.length) || this.catSeat !== null)) {
      for (const q of alive) { this.toDiscard(q.blue); q.blue = []; }
      this.catSeat = null;
      this.log('เหลือผู้เล่น 2 คน — การ์ดสีน้ำเงินทั้งหมด (รวมแมวดำ) ถูกทิ้ง');
    }
  }

  checkWin() {
    const witchCards = this.players.flatMap((p) => p.tryal).filter((c) => c.kind === 'w');
    if (witchCards.every((c) => c.revealed)) throw new GameOver(this.makeResult('town', 'การ์ดแม่มดทุกใบถูกเปิดแล้ว — ชาวเมืองชนะ! 🏛'));
    const alive = this.alive();
    if (alive.every((p) => p.witch)) throw new GameOver(this.makeResult('witch', 'เหลือแต่แม่มดที่ยังมีชีวิต — แม่มดชนะ! 🧹'));
  }

  // ════════════════════════════ powers ════════════════════════════

  async usePower(p, a) {
    p.used = true;
    const who = this.nm(p);
    switch (p.char) {
      case 'mather': {
        const c = a.target.tryal[a.index];
        this.note(p, `🔍 คุณแอบดูการ์ดใบที่ ${a.index + 1} ของ ${this.nm(a.target)}: ${TRYALS[c.kind].name}`);
        p.mind.peek = { seat: a.target.seat, id: c.id, kind: c.kind };
        this.feed(`🔍 ${who} ใช้พลัง「สอบสวนลับ」แอบดูการ์ดไต่สวนของ ${this.nm(a.target)} 1 ใบ`, { from: p.seat, to: [a.target.seat], card: 'power' });
        break;
      }
      case 'jproctor': {
        const i = p.red.findIndex((r) => r.card.type === 'accusation');
        const [r] = p.red.splice(i, 1);
        a.target.red.push(r);
        this.feed(`👉 ${who} ใช้พลัง「โยนความผิด」ย้ายการ์ดกล่าวหา 1 ใบไปหา ${this.nm(a.target)} (${this.total(a.target)}/${this.threshold(a.target)})`, { from: p.seat, to: [a.target.seat], card: 'power' });
        this.emit({ type: 'accuse', from: p.seat, to: a.target.seat, card: 'accusation', total: this.total(a.target) });
        await this.checkAccuse(a.target, p);
        break;
      }
      case 'parris': {
        const n = this.removeAccusations(a.target, 2);
        this.feed(`📖 ${who} ใช้พลัง「เทศนา」ทิ้งการ์ดกล่าวหา ${n} ใบจาก ${this.nm(a.target)}`, { from: p.seat, to: [a.target.seat], card: 'power' });
        this.emit({ type: 'defend', from: p.seat, to: a.target.seat });
        break;
      }
      case 'tituba': {
        const top = this.deck.slice(-3).reverse(); // บนสุดก่อน
        const r = await this.ask(p, { type: 'tituba', cards: top.map(cardOut) });
        const byId = new Map(top.map((c) => [c.id, c]));
        this.deck.splice(-top.length, top.length, ...r.order.map((id) => byId.get(id)).reverse());
        this.feed(`🔮 ${who} ใช้พลัง「ทำนาย」ดูการ์ด ${top.length} ใบบนกองจั่วแล้วเรียงใหม่`, { from: p.seat, art: ['chars', 'tituba'], ms: 2000 });
        break;
      }
      default: break;
    }
    this.update();
  }

  // ════════════════════════════ night & conspiracy ════════════════════════════

  async night() {
    this.phase = 'night';
    this.nightNo++;
    this.feed(`🌙 ราตรีที่ ${this.nightNo} มาเยือน… ทุกคนหลับตา`, { art: ['cards', 'night'], ms: 2000, kind: 'night' });
    this.emit({ type: 'nightStart' });
    await this.settle();
    const victimSeat = await this.witchVote('kill');
    const cons = this.constable();
    let protect = null;
    this.gavelSeat = null;
    if (cons) {
      const options = this.alive().filter((q) => q !== cons).map((q) => q.seat);
      if (options.length) {
        const a = await this.ask(cons, { type: 'protect', options });
        protect = a.target;
        this.note(cons, `🛡 คืนนี้คุณวางค้อนปกป้อง ${this.nm(this.players[protect])}`);
      }
    }
    // ทุกคนลืมตา: เห็นค้อนหน้าผู้ที่ถูกปกป้อง แล้วใครจะสารภาพก็ได้
    if (protect !== null) {
      this.gavelSeat = protect;
      this.feed(`🔨 ผู้คุ้มกันวางค้อนไว้หน้า ${this.nm(this.players[protect])} — คืนนี้รอดแน่นอน`, { to: [protect], art: ['tryal', 'c'], ms: 2500, kind: 'gavel' });
      await this.settle();
    }
    // สารภาพ: ทุกคนเลือกพร้อมกัน
    this.phase = 'confess';
    this.log('🕯 ใครจะสารภาพ? (เปิดการ์ดไต่สวนของตัวเอง 1 ใบ เพื่อรอดจากความตายคืนนี้)');
    const deadline = Date.now() + this.timeouts.quick;
    const alive = this.alive();
    const answers = await Promise.all(alive.map((q) => this.ask(q, { type: 'confess', deadline })));
    const confessed = new Set();
    for (let i = 0; i < alive.length; i++) {
      const q = alive[i];
      if (answers[i].index === null || !q.alive || q.tryal[answers[i].index].revealed) continue;
      confessed.add(q.seat);
      this.reveal(q, answers[i].index, 'สารภาพ');
      if (q.alive && q.char === 'nurse') this.draw(q, 2, ' (พลังรีเบคกา)');
    }
    if (!confessed.size) this.log('ไม่มีใครสารภาพ');
    await this.settle();
    this.checkWin();
    // เช้า
    const v = victimSeat === null ? null : this.players[victimSeat];
    let text;
    if (!v || !v.alive) text = 'รุ่งเช้า… ไม่มีใครถูกสังหาร';
    else if (protect === v.seat || confessed.has(v.seat) || this.hasBlue(v, 'asylum')) text = 'รุ่งเช้า… ทุกคนยังอยู่ครบ ไม่มีใครถูกสังหาร';
    else text = null;
    if (text) {
      this.feed(`☀ ${text}`, { art: ['cards', 'asylum'], ms: 3500, kind: 'morning' });
      this.emit({ type: 'morning', victim: null });
    } else {
      this.feed(`☀ รุ่งเช้า… พบ ${this.nm(v)} ถูกสังหารในยามราตรี`, { to: [v.seat], art: ['cards', 'night'], ms: 2500, kind: 'morning' });
      const matched = this.hasBlue(v, 'matchmaker');
      this.kill(v, 'ถูกแม่มดสังหาร');
      // แม่สื่อ: ถ้าผู้ถือแม่สื่อถูกฆ่าในยามราตรี ผู้ถือแม่สื่ออีกคนตายด้วย (แม้จะสารภาพหรือได้ค้อน)
      if (matched) for (const q of this.alive()) if (this.hasBlue(q, 'matchmaker')) this.kill(q, `แม่สื่อผูกชะตาไว้กับ ${this.nm(v)}`);
      this.emit({ type: 'morning', victim: v.seat });
      this.checkWin();
    }
    await this.settle();
    // กองจั่วที่เหลือกับกองทิ้งสับรวมกันเป็นกองใหม่ แล้ววางราตรีไว้ใบล่างสุดอีกครั้ง
    // (ถ้าทิทูบาย้ายราตรีขึ้นมา กองจั่วยังเหลือ: วางราตรีไว้ล่างสุดของกองที่เหลือ แล้วสับกองทิ้งเมื่อกองหมดเท่านั้น)
    const nightCard = this.discard.find((c) => c.type === 'night');
    this.discard = this.discard.filter((c) => c !== nightCard);
    if (!this.deck.length) { this.deck = shuffle(this.discard, this.rnd); this.discard = []; }
    if (nightCard) this.deck.unshift(nightCard);
    this.phase = 'day';
    this.update();
  }

  async conspiracy(drawer) {
    this.phase = 'conspiracy';
    this.feed('🐈‍⬛ สมรู้ร่วมคิด! ผู้ถือแมวดำต้องเปิดการ์ด แล้วทุกคนส่งการ์ดไต่สวนต่อ', { from: drawer.seat, art: ['cards', 'conspiracy'], ms: 2500, kind: 'black' });
    this.emit({ type: 'conspiracy' });
    await this.settle();
    const cat = this.catSeat === null ? null : this.players[this.catSeat];
    if (cat && cat.alive && this.hidden(cat).length) {
      this.log(`${this.nm(drawer)} เลือกการ์ดของผู้ถือแมวดำ (${this.nm(cat)}) ให้เปิด 1 ใบ`);
      const r = await this.ask(drawer, { type: 'reveal', target: cat.seat, indexes: this.hidden(cat), why: 'cat' });
      this.reveal(cat, r.index, 'ผู้ถือแมวดำ');
      await this.settle();
      this.checkWin();
    } else {
      this.log('ผู้ถือแมวดำไม่อยู่แล้ว ข้ามการเปิดการ์ด');
    }
    const alive = this.alive();
    if (alive.length >= 2) {
      this.log('ทุกคนหยิบการ์ดไต่สวน 1 ใบ (แบบไม่เห็นหน้า) จากผู้เล่นทางซ้าย…');
      const deadline = Date.now() + this.timeouts.quick;
      const picks = await Promise.all(alive.map((q) => {
        const left = this.nextAlive(q);
        return this.ask(q, { type: 'conspTake', target: left.seat, indexes: this.hidden(left), deadline });
      }));
      const moves = alive.map((q, i) => {
        const from = this.nextAlive(q);
        return { to: q, from, card: from.tryal[picks[i].index] };
      });
      for (const m of moves) m.from.tryal = m.from.tryal.filter((c) => c !== m.card);
      for (const m of moves) {
        m.to.tryal.push(m.card);
        const was = m.to.witch;
        if (m.card.kind === 'w') m.to.witch = true;
        this.note(m.to, `🂠 คุณได้การ์ด「${TRYALS[m.card.kind].name}」จาก ${this.nm(m.from)}${!was && m.to.witch ? ' — ตอนนี้คุณเป็นแม่มดแล้ว! 🧹' : ''}`);
      }
      this.feed('🔄 ทุกคนส่งการ์ดไต่สวนต่อเรียบร้อย ใครได้การ์ดแม่มดจะกลายเป็นแม่มด…', { art: ['misc', 'tryalback'], ms: 3000, kind: 'black' });
      await this.settle();
      this.checkWin();
    }
    this.phase = 'day';
    this.update();
  }

  // ════════════════════════════ ending ════════════════════════════

  makeResult(winner, text) {
    const winners = winner === 'draw' ? [] : this.players.filter((p) => (winner === 'witch' ? p.witch : !p.witch)).map((p) => p.pid);
    const alive = this.alive();
    return {
      winner, text, winners,
      // สถานะตอนจบ (ก่อนเปิดการ์ดทั้งหมด) ใช้ตรวจความถูกต้องของผู้ชนะ
      check: {
        hiddenWitchCards: this.players.flatMap((p) => p.tryal).filter((c) => c.kind === 'w' && !c.revealed).length,
        aliveTown: alive.filter((p) => !p.witch).length,
        aliveWitches: alive.filter((p) => p.witch).length,
      },
      roles: this.players.map((p) => ({
        seat: p.seat, pid: p.pid, name: p.name, char: p.char, alive: p.alive, witch: p.witch,
        tryal: p.tryal.map((c) => c.kind),
      })),
    };
  }

  finish(result) {
    this.result = result;
    this.phase = 'over';
    this.activeSeat = null;
    this.ballot = null;
    for (const e of [...this.pending.values()]) e.timers.forEach(clearTimeout);
    this.pending.clear();
    this.log(`🏁 จบเกม: ${result.text}`);
    this.emit({ type: 'over', winner: result.winner });
    this.update();
  }

  abort() {
    this.aborted = true;
    for (const t of this.sleepTimers) clearTimeout(t);
    for (const e of [...this.pending.values()]) {
      e.timers.forEach(clearTimeout);
      e.reject(new GameAborted());
    }
    this.pending.clear();
  }

  setConnected(pid, connected) {
    const p = this.player(pid);
    if (!p) return;
    p.connected = connected;
    const e = this.pending.get(pid);
    if (e && !connected && !p.isBot) this.addDisconnectTimer(e);
    if (e && connected) clearTimeout(e.dcTimer); // กลับมาทันเวลา: ตอบเองได้
    this.update();
  }

  setBot(pid) {
    const p = this.player(pid);
    if (!p || p.isBot) return;
    p.isBot = true;
    const e = this.pending.get(pid);
    if (e) this.scheduleBot(e);
    this.update();
  }

  // ════════════════════════════ views ════════════════════════════

  /** มุมมองของผู้เล่นคนหนึ่ง — ไม่ส่งมือ/การ์ดไต่สวนที่คว่ำ/ตัวตนแม่มดของคนอื่น */
  viewFor(pid) {
    const me = this.player(pid);
    const over = this.phase === 'over';
    const pe = me && this.pending.get(me.pid);
    const iAmWitch = !!(me && me.witch);
    const PUBLIC_WAIT = new Set(['turn', 'reveal', 'bribe', 'discard1', 'tituba', 'confess', 'conspTake']);
    return {
      phase: this.phase,
      phaseName: PHASE_NAMES[this.phase],
      turnNo: this.turnNo,
      nightNo: this.nightNo,
      activeSeat: this.activeSeat,
      mySeat: me ? me.seat : null,
      catSeat: this.catSeat,
      gavelSeat: this.gavelSeat,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      discardTop: cardOut(this.discard[this.discard.length - 1]),
      players: this.players.map((p) => ({
        seat: p.seat, pid: p.pid, name: p.name, isBot: p.isBot, connected: p.connected,
        char: p.char, alive: p.alive, handCount: p.hand.length,
        tryal: p.tryal.map((c) => (c.revealed || over ? { kind: c.kind, revealed: true } : (p === me ? { kind: c.kind, revealed: false, mine: true } : { revealed: false }))),
        red: p.red.map((r) => ({ id: r.card.id, type: r.card.type, value: r.value })),
        total: this.total(p), threshold: this.threshold(p),
        blue: p.blue.map(cardOut),
        stocked: p.stocks.length, used: p.used,
        witch: over || (iAmWitch && p.witch) || (p === me && p.witch) ? p.witch : null,
      })),
      hand: me ? me.hand.map(cardOut) : [],
      notes: me ? me.notes.slice(-12) : [],
      ballot: iAmWitch && this.ballot ? this.ballot : null,
      events: this.events,
      log: this.logs.slice(-80),
      waiting: [...this.pending.values()]
        .filter((e) => PUBLIC_WAIT.has(e.req.type) || e.p === me)
        .map((e) => ({ seat: e.p.seat, type: e.req.type, deadline: e.req.deadline })),
      prompt: pe ? pe.req : null,
      result: this.result,
    };
  }
}

module.exports = { Game, GameOver, GameAborted, MIN_PLAYERS, MAX_PLAYERS, THRESHOLD, PHASE_NAMES, shuffle };
