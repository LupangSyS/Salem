'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

function client(url) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.last = null;
  s.on('state', (st) => { s.last = st; });
  return s;
}
function waitFor(s, pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    if (s.last && pred(s.last)) return resolve(s.last);
    const t = setTimeout(() => { s.off('state', h); reject(new Error('timeout waiting for state')); }, ms);
    const h = (st) => { if (pred(st)) { clearTimeout(t); s.off('state', h); resolve(st); } };
    s.on('state', h);
  });
}
async function boot(opts) {
  const ctx = createServer(opts);
  await new Promise((r) => ctx.server.listen(0, r));
  ctx.url = `http://localhost:${ctx.server.address().port}`;
  ctx.socks = [];
  ctx.client = () => { const c = client(ctx.url); ctx.socks.push(c); return c; };
  ctx.close = async () => {
    for (const s of ctx.socks) s.close();
    for (const r of ctx.rooms.rooms.values()) ctx.rooms.destroy(r);
    ctx.io.close();
    await new Promise((r) => ctx.server.close(r));
  };
  return ctx;
}
/** สร้างห้อง: อลิซ (หัวห้อง) + บ๊อบ + บอท 2 ตัว แล้วเริ่มเกม */
async function setupGame(ctx) {
  const a = ctx.client();
  a.emit('hello', { token: 'token-alice-123' });
  await waitFor(a, (st) => st.room === null);
  a.emit('create', { name: 'อลิซ' });
  const s1 = await waitFor(a, (st) => st.room && st.room.players.length === 1);
  const code = s1.room.code;
  const b = ctx.client();
  b.emit('hello', { token: 'token-bob-456' });
  await waitFor(b, (st) => st.room === null);
  b.emit('join', { code: code.toLowerCase(), name: 'บ๊อบ' });
  await waitFor(b, (st) => st.room && st.room.players.length === 2);
  return { a, b, code, s1 };
}

test('end-to-end: create room → join → chat → bots → start → disconnect → rejoin same seat and prompt', async () => {
  const ctx = await boot({ botDelay: 0, talkDelay: 0, firstSeat: 1, timeouts: { turn: 20000, quick: 20000, disconnected: 20000 } });
  try {
    const { a, b, code, s1 } = await setupGame(ctx);
    assert.match(code, /^[A-Z2-9]{4}$/);
    assert.strictEqual(s1.room.hostPid, s1.me);

    b.emit('chat', { text: 'สวัสดี' });
    await waitFor(a, (st) => st.room.chat.some((m) => m.from === 'บ๊อบ' && m.text === 'สวัสดี'));

    // คนที่ไม่ใช่หัวห้องเริ่มเกม/เพิ่มบอทไม่ได้; ผู้เล่นไม่ครบ 4 เริ่มไม่ได้
    b.emit('start'); b.emit('addBot');
    const tooFew = new Promise((r) => a.once('toast', r));
    a.emit('start');
    assert.match(await tooFew, /อย่างน้อย 4 คน/);
    a.emit('addBot'); a.emit('addBot'); a.emit('addBot');
    const s4 = await waitFor(a, (st) => st.room.players.length === 5);
    const bot = s4.room.players.find((p) => p.isBot);
    a.emit('kick', { pid: bot.pid });
    await waitFor(a, (st) => st.room.players.length === 4 && st.room.status === 'lobby');
    a.emit('start');
    await waitFor(a, (st) => st.room.status === 'playing' && st.game);

    // บ๊อบ (ที่นั่ง 1) ได้คำสั่งของตัวเอง แล้วหลุดกลางเกม
    const withPrompt = await waitFor(b, (st) => st.game && st.game.prompt);
    const bobPid = withPrompt.me;
    const promptId = withPrompt.game.prompt.id;
    assert.strictEqual(withPrompt.game.mySeat, 1);
    assert.strictEqual(withPrompt.game.hand.length, 3, 'bob sees his own hand');
    const aliceView = a.last.game.players.find((p) => p.pid === bobPid);
    assert.ok(!('hand' in aliceView), 'alice cannot see bob\'s hand');
    assert.ok(aliceView.tryal.every((c) => !('kind' in c)), 'alice cannot see bob\'s hidden tryal cards');
    b.disconnect();
    await waitFor(a, (st) => st.room.players.some((p) => p.pid === bobPid && !p.connected));

    const b2 = ctx.client();
    b2.emit('hello', { token: 'token-bob-456' });
    const back = await waitFor(b2, (st) => st.room && st.game);
    assert.strictEqual(back.me, bobPid, 'same seat after rejoin');
    assert.strictEqual(back.game.mySeat, 1);
    assert.strictEqual(back.room.code, code);
    assert.strictEqual(back.game.prompt && back.game.prompt.id, promptId, 'pending prompt restored');
    await waitFor(a, (st) => st.room.players.some((p) => p.pid === bobPid && p.connected));

    // ตอบผิดถูกปฏิเสธ ตอบถูกผ่าน
    const toastBad = new Promise((r) => b2.once('toast', r));
    b2.emit('answer', { promptId, data: { action: 'fly' } });
    assert.strictEqual(await toastBad, 'การเลือกไม่ถูกต้อง');
    const pr = back.game.prompt;
    const good = pr.type === 'turn' ? { action: 'draw' } : pr.type === 'witchVote' ? { target: pr.options[0] } : { index: null };
    b2.emit('answer', { promptId, data: good });
    await waitFor(b2, (st) => !st.game.prompt || st.game.prompt.id !== promptId);
  } finally {
    await ctx.close();
  }
});

test('a disconnected player\'s pending prompt is answered by a bot after the grace period', async () => {
  const ctx = await boot({ botDelay: 0, talkDelay: 0, firstSeat: 1, timeouts: { turn: 20000, quick: 20000, disconnected: 300 } });
  try {
    const { a, b } = await setupGame(ctx);
    a.emit('addBot'); a.emit('addBot');
    await waitFor(a, (st) => st.room.players.length === 4);
    a.emit('start');
    const st = await waitFor(b, (s) => s.game && s.game.prompt);
    const room = [...ctx.rooms.rooms.values()][0];
    const bobPid = st.me;
    const id = st.game.prompt.id;
    b.disconnect();
    const t0 = Date.now();
    while (room.game.pending.get(bobPid) && room.game.pending.get(bobPid).id === id) {
      if (Date.now() - t0 > 4000) throw new Error('bot did not step in');
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(Date.now() - t0 >= 250, 'waited for the grace period first');
    assert.ok(!room.game.player(bobPid).isBot, 'seat is only covered, not handed over permanently');
  } finally {
    await ctx.close();
  }
});

test('leaving mid-game hands the seat to a bot permanently; witch chat stays private', async () => {
  const ctx = await boot({ botDelay: 0, talkDelay: 0, timeouts: { turn: 20000, quick: 20000, disconnected: 20000 } });
  try {
    const { a, b } = await setupGame(ctx);
    a.emit('addBot'); a.emit('addBot');
    await waitFor(a, (st) => st.room.players.length === 4);
    a.emit('start');
    const st = await waitFor(b, (s) => s.game);
    const room = [...ctx.rooms.rooms.values()][0];
    const g = room.game;
    // ข้อความในช่องแม่มดไม่ถูกส่งถึงชาวเมือง
    ctx.rooms.pushChat(room, { from: 'x', seat: 0, text: 'ลับเฉพาะแม่มด', scope: 'witch' });
    ctx.rooms.broadcast(room);
    const town = [a, b].find((s) => s.last.game && !s.last.game.players[s.last.game.mySeat].witch);
    if (town) {
      await new Promise((r) => setTimeout(r, 80));
      assert.ok(!town.last.room.chat.some((m) => m.text === 'ลับเฉพาะแม่มด'), 'town players never receive witch chat');
    }
    const bobPid = st.me;
    b.emit('leave');
    await waitFor(a, (s) => s.room.players.some((p) => p.pid === bobPid && p.left));
    assert.strictEqual(g.player(bobPid).isBot, true, 'bot plays the seat');
    const b2 = ctx.client();
    b2.emit('hello', { token: 'token-bob-456' });
    const again = await waitFor(b2, (s) => 'room' in s);
    assert.strictEqual(again.room, null, 'the old token no longer owns the seat');
  } finally {
    await ctx.close();
  }
});
