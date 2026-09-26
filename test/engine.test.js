'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Game, GameOver, MIN_PLAYERS, MAX_PLAYERS } = require('../server/game/engine');
const { CARDS, DECK_SIZE, TRYAL_TABLE, buildTryals } = require('../server/game/cards');

const players = (n, humans = []) => Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, name: `P${i}`, isBot: !humans.includes(i) }));

/** ตรวจกฎที่ต้องเป็นจริงตลอดเกม */
function invariants(g) {
  const ids = [];
  for (const c of g.deck) ids.push(c.id);
  for (const c of g.discard) ids.push(c.id);
  for (const p of g.players) {
    for (const c of p.hand) ids.push(c.id);
    for (const r of p.red) ids.push(r.card.id);
    for (const c of p.blue) ids.push(c.id);
    for (const c of p.hand) assert.notStrictEqual(CARDS[c.type].color, 'black', 'black cards never stay in a hand');
    for (const r of p.red) assert.strictEqual(CARDS[r.card.type].color === 'red' || r.card.type === 'accusation', true);
    for (const c of p.blue) assert.strictEqual(CARDS[c.type].color, 'blue');
    if (!p.alive) {
      assert.strictEqual(p.hand.length + p.red.length + p.blue.length, 0, 'the dead hold nothing');
      assert.ok(p.tryal.every((c) => c.revealed), 'the dead have every tryal card revealed');
    }
    if (p.tryal.some((c) => c.kind === 'w')) assert.ok(p.witch, 'holding a witch card makes you a witch');
    if (p.alive) assert.ok(p.tryal.some((c) => !c.revealed), 'the living keep at least one hidden card');
  }
  assert.strictEqual(ids.length, DECK_SIZE, 'no card lost or duplicated');
  assert.strictEqual(new Set(ids).size, DECK_SIZE, 'every card id is unique');
  const tr = g.players.flatMap((p) => p.tryal);
  const n = g.players.length;
  const [per, witches] = TRYAL_TABLE[n];
  assert.strictEqual(tr.length, per * n, 'tryal card count is constant');
  assert.strictEqual(new Set(tr.map((c) => c.id)).size, tr.length, 'tryal ids are unique');
  assert.strictEqual(tr.filter((c) => c.kind === 'w').length, witches);
  assert.strictEqual(tr.filter((c) => c.kind === 'c').length, 1);
}

test('tryal table matches the confirmed rules for 4–12 players', () => {
  assert.strictEqual(MIN_PLAYERS, 4);
  assert.strictEqual(MAX_PLAYERS, 12);
  const expect = { 4: [5, 1], 5: [5, 1], 6: [5, 2], 7: [5, 2], 8: [4, 2], 9: [4, 2], 10: [4, 2], 11: [3, 2], 12: [3, 2] };
  assert.deepStrictEqual(TRYAL_TABLE, expect);
  for (let n = 4; n <= 12; n++) {
    const k = buildTryals(n);
    assert.strictEqual(k.length, expect[n][0] * n);
    assert.strictEqual(k.filter((x) => x === 'c').length, 1);
  }
  assert.strictEqual(DECK_SIZE, 60);
  assert.throws(() => new Game({ players: players(3) }));
  assert.throws(() => new Game({ players: players(13) }));
});

test('setup: 3 cards each, night in the bottom quarter, conspiracy somewhere in the deck, unique characters', () => {
  for (let k = 0; k < 40; k++) {
    const g = new Game({ players: players(4 + (k % 9)), botDelay: 0 });
    for (const p of g.players) assert.strictEqual(p.hand.length, 3);
    const ni = g.deck.findIndex((c) => c.type === 'night');
    assert.ok(ni >= 0 && ni <= Math.floor((g.deck.length - 1) / 4) + 1, `night near the bottom (index ${ni} of ${g.deck.length})`);
    assert.ok(g.deck.some((c) => c.type === 'conspiracy'));
    assert.strictEqual(new Set(g.players.map((p) => p.char)).size, g.players.length);
    invariants(g);
  }
});

test('hundreds of simulated all-bot games across every player count keep every invariant and pick the right winner', async () => {
  const perCount = 34;
  let games = 0;
  const wins = { town: 0, witch: 0, draw: 0 };
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (let k = 0; k < perCount; k++) {
      let checks = 0;
      const g = new Game({ players: players(n), botDelay: 0, onUpdate: () => { if (++checks % 7 === 0 && g.phase !== 'over') invariants(g); } });
      const r = await g.run();
      invariants(g);
      games++;
      wins[r.winner]++;
      assert.notStrictEqual(r.winner, 'draw', `game with ${n} players ended in a draw after ${g.turnNo} turns`);
      if (r.winner === 'town') assert.strictEqual(r.check.hiddenWitchCards, 0, 'town wins only when every witch card is revealed');
      if (r.winner === 'witch') {
        assert.strictEqual(r.check.aliveTown, 0, 'witches win only when no town player is alive');
        assert.ok(r.check.hiddenWitchCards > 0);
      }
      const team = new Set(g.players.filter((p) => (r.winner === 'witch' ? p.witch : !p.witch)).map((p) => p.pid));
      assert.deepStrictEqual(new Set(r.winners), team, 'winners are exactly the winning team');
      assert.strictEqual(g.pending.size, 0, 'no prompt left dangling');
    }
  }
  assert.ok(games >= 300);
  assert.ok(wins.town > 0 && wins.witch > 0, `both sides can win (${JSON.stringify(wins)})`);
});

// ─────────────── helpers for scripted rule tests ───────────────
/** เกมที่ตัดสินใจด้วยสคริปต์ (แทนที่ ask) */
function scripted(n, rig, script) {
  const neutral = ['mather', 'jproctor', 'parris', 'tituba', 'abigail', 'osborne'];
  const g = new Game({ players: players(n), botDelay: 0, firstSeat: 0, rig: (g) => { g.players.forEach((p, i) => { p.char = neutral[i]; }); rig(g); } });
  blackToBottom(g);
  g.asked = [];
  g.ask = async (p, req) => {
    g.asked.push({ seat: p.seat, type: req.type, req });
    const a = script(p, req, g);
    const norm = g.normalize(p, req, a);
    assert.ok(norm, `scripted answer for ${req.type} must be valid`);
    return norm;
  };
  return g;
}
function setTryals(g, lists) {
  let id = 1000;
  g.players.forEach((p, i) => { p.tryal = lists[i].map((kind) => ({ id: ++id, kind, revealed: false })); });
  for (const p of g.players) p.witch = false;
}
/** เอาการ์ดดำไปไว้ล่างสุดของกอง เพื่อให้การจั่วในการทดสอบคาดเดาได้ */
function blackToBottom(g) {
  const black = g.deck.filter((c) => CARDS[c.type].color === 'black');
  g.deck = [...black, ...g.deck.filter((c) => !black.includes(c))];
}
/** หยิบการ์ดชนิดที่ต้องการจากกองจั่ว กองทิ้ง หรือมือผู้เล่นอื่น มาใส่มือ p */
function take(g, type) {
  for (const pile of [g.deck, g.discard, ...g.players.map((x) => x.hand)]) {
    const i = pile.findIndex((c) => c.type === type);
    if (i >= 0) return pile.splice(i, 1)[0];
  }
  throw new Error(`no free ${type} card`);
}
function give(g, p, type) {
  const c = take(g, type);
  p.hand.push(c);
  return c;
}
function giveBlue(g, p, type) {
  const c = give(g, p, type);
  p.hand = p.hand.filter((x) => x !== c);
  p.blue.push(c);
  return c;
}

test('7 accusations force a reveal chosen by the last accuser; a revealed witch dies; town wins', async () => {
  const g = scripted(4, (g) => {
    setTryals(g, [['nw', 'nw', 'nw', 'nw', 'c'], ['nw', 'w', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]);
    g.players[1].char = 'jproctor';
  }, (p, req) => (req.type === 'reveal' ? { index: 1 } : null));
  g.syncWitches();
  const [a, b] = g.players;
  const ev = give(g, a, 'evidence');
  const ac = give(g, a, 'accusation');
  b.red.push({ card: take(g, 'evidence'), value: 3 });
  await g.playCard(a, g.normalize(a, { type: 'turn', played: false }, { action: 'play', card: ev.id, target: 1 }));
  assert.strictEqual(g.total(b), 6);
  assert.ok(!g.asked.length, 'no reveal below 7');
  await assert.rejects(g.playCard(a, g.normalize(a, { type: 'turn', played: true }, { action: 'play', card: ac.id, target: 1 })), (e) => {
    assert.ok(e instanceof GameOver);
    assert.strictEqual(e.result.winner, 'town');
    return true;
  });
  assert.deepStrictEqual(g.asked.map((x) => [x.seat, x.type, x.req.target]), [[0, 'reveal', 1]]);
  assert.ok(!b.alive, 'revealed witch dies');
  assert.strictEqual(b.red.length, 0);
  invariants(g);
});

test('a non-witch reveal discards the red cards; Giles needs 8; Sarah Good curses the accuser', async () => {
  const g = scripted(5, (g) => {
    setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'w'], ['nw', 'nw', 'nw', 'nw', 'c'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]);
    g.players[1].char = 'gcorey';
    g.players[2].char = 'good';
    g.players[0].char = 'putnam';
  }, (p, req) => (req.type === 'reveal' ? { index: req.indexes[0] } : null));
  g.syncWitches();
  const [a, giles, sarah] = g.players;
  const w = give(g, a, 'witness');
  await g.playCard(a, { action: 'play', card: w, target: giles });
  assert.strictEqual(g.total(giles), 7);
  assert.ok(!g.asked.length, 'Giles does not reveal at 7');
  // Sarah Good: เปิดได้ "ไม่ใช่แม่มด" → ผู้กล่าวหาได้การ์ดกล่าวหา 1 ใบจากกองทิ้ง
  g.discard.push(take(g, 'accusation'));
  sarah.red.push({ card: take(g, 'evidence'), value: 3 });
  sarah.red.push({ card: take(g, 'evidence'), value: 3 });
  const ac = give(g, a, 'accusation');
  await g.playCard(a, { action: 'play', card: ac, target: sarah });
  assert.strictEqual(sarah.tryal.filter((c) => c.revealed).length, 1);
  assert.strictEqual(sarah.red.length, 0, 'red cards discarded after the reveal');
  assert.strictEqual(g.total(a), 1, 'accuser receives one accusation from Sarah Good');
  invariants(g);
});

test('matchmaker drags the partner down; Elizabeth draws when someone dies', async () => {
  const g = scripted(6, (g) => {
    setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]);
    g.players[5].char = 'eproctor';
  }, (p, req) => (req.type === 'reveal' ? { index: 0 } : null));
  g.syncWitches();
  const [a, w1, b] = g.players;
  giveBlue(g, w1, 'matchmaker');
  giveBlue(g, b, 'matchmaker');
  const wi = give(g, a, 'witness');
  const before = g.players[5].hand.length;
  await g.playCard(a, { action: 'play', card: wi, target: w1 });
  assert.ok(!w1.alive && !b.alive, 'both matchmaker holders die');
  assert.strictEqual(g.players[5].hand.length, before + 2, 'Elizabeth draws one card per death');
  invariants(g);
});

test('night: witches kill the victim unless protected, confessed or in asylum; night goes back under the deck', async () => {
  const base = [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']];
  const run = async (opts) => {
    const g = scripted(5, (g) => { setTryals(g, base); }, (p, req) => {
      if (req.type === 'witchVote') return { target: 0 };
      if (req.type === 'protect') return { target: opts.protect };
      if (req.type === 'confess') return { index: opts.confess && p.seat === 0 ? 1 : null };
      return null;
    });
    g.syncWitches();
    if (opts.asylum) giveBlue(g, g.players[0], 'asylum');
    const night = g.deck.splice(g.deck.findIndex((c) => c.type === 'night'), 1)[0];
    g.discard.push(night);
    const deckTop = g.deck[g.deck.length - 1];
    await g.night();
    assert.strictEqual(g.discard.length, 0, 'discard shuffled back');
    assert.strictEqual(g.deck[g.deck.length - 1], deckTop, 'the draw pile top is unchanged (night goes underneath)');
    assert.ok(g.deck.indexOf(night) < g.deck.length - 1);
    const types = g.asked.map((x) => x.type);
    assert.deepStrictEqual(types.slice(0, 2), ['witchVote', 'protect'], 'witches first, then the constable');
    assert.strictEqual(g.asked.find((x) => x.type === 'protect').seat, 2);
    assert.ok(!g.asked.find((x) => x.type === 'protect').req.options.includes(2), 'constable cannot protect themselves');
    assert.strictEqual(types.filter((t) => t === 'confess').length, 5, 'everyone alive may confess');
    invariants(g);
    return g.players[0].alive;
  };
  assert.strictEqual(await run({ protect: 3 }), false, 'unprotected victim dies');
  assert.strictEqual(await run({ protect: 0 }), true, 'constable saves the victim');
  assert.strictEqual(await run({ protect: 3, confess: true }), true, 'confession saves the victim');
  assert.strictEqual(await run({ protect: 3, asylum: true }), true, 'asylum saves the victim');
});

test('witch vote: disagreement triggers a second round showing the first-round picks', async () => {
  const g = scripted(6, (g) => {
    setTryals(g, [['w', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]);
  }, (p, req) => {
    if (req.round === 1) return { target: p.seat === 0 ? 3 : 4 };
    return { target: 4 };
  });
  g.syncWitches();
  const pick = await g.witchVote('kill');
  assert.strictEqual(pick, 4);
  const votes = g.asked.filter((x) => x.type === 'witchVote');
  assert.strictEqual(votes.length, 4, 'two witches × two rounds');
  assert.deepStrictEqual(votes[2].req.prev, { 0: 3, 1: 4 });
});

test('conspiracy: drawer picks the black-cat card to reveal, then everyone takes a card from the player on their left', async () => {
  const g = scripted(4, (g) => {
    setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]);
  }, (p, req) => {
    if (req.type === 'reveal') return { index: 4 };
    if (req.type === 'conspTake') return { index: 0 };
    return null;
  });
  g.syncWitches();
  g.catSeat = 3;
  await g.conspiracy(g.players[0]);
  assert.deepStrictEqual(g.asked[0], { seat: 0, type: 'reveal', req: g.asked[0].req });
  assert.strictEqual(g.asked[0].req.target, 3);
  assert.ok(g.players[3].tryal.some((c) => c.revealed));
  const takes = g.asked.filter((x) => x.type === 'conspTake');
  assert.deepStrictEqual(takes.map((x) => [x.seat, x.req.target]), [[0, 1], [1, 2], [2, 3], [3, 0]], 'each takes from the next player (their left)');
  assert.ok(g.players[0].witch, 'player 0 took the witch card and became a witch');
  assert.ok(g.players[1].witch, 'player 1 stays a witch after giving the card away');
  assert.ok(g.players[1].tryal.some((c) => c.kind === 'c'), 'constable card moved to player 1');
  for (const p of g.players) assert.strictEqual(p.tryal.length, 5);
  invariants(g);
});

test('win conditions', () => {
  const g = new Game({ players: players(4), botDelay: 0, rig: (g) => setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]) });
  g.syncWitches();
  assert.doesNotThrow(() => g.checkWin());
  for (const i of [0, 2, 3]) g.kill(g.players[i], 'test');
  assert.throws(() => g.checkWin(), (e) => e.result.winner === 'witch' && e.result.winners.length === 1 && e.result.winners[0] === 'p1');
  const h = new Game({ players: players(4), botDelay: 0, rig: (g) => setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]) });
  h.syncWitches();
  h.players[1].tryal[0].revealed = true;
  assert.throws(() => h.checkWin(), (e) => e.result.winner === 'town' && e.result.winners.length === 3);
});

// ─────────────── answer validation through the real prompt system ───────────────
function waitPrompt(g, pid, type, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const e = g.pending.get(pid);
      if (e && (!type || e.req.type === type)) { clearInterval(iv); resolve(e); }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${type}`)); }
    }, 2);
  });
}

test('answer validation: invalid answers are rejected and the prompt stays open', async () => {
  const g = new Game({
    players: players(5, [0]), botDelay: 0, firstSeat: 0, timeouts: { turn: 60000, quick: 60000 },
    rig: (g) => {
      setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]);
      ['putnam', 'mather', 'osborne', 'mcorey', 'parris'].forEach((c, i) => { g.players[i].char = c; });
    },
  });
  const me = g.players[0];
  const run = g.run();
  try {
  // รุ่งอรุณ: ผู้เล่น 0 ไม่ใช่แม่มด จึงไม่ถูกถาม ตาแรกเป็นของผู้เล่น 0
  let e = await waitPrompt(g, 'p0', 'turn');
  g.discard.push(...me.hand);
  me.hand = [];
  const acc = give(g, me, 'accusation');
  const stocks = give(g, me, 'stocks');
  const rob = give(g, me, 'robbery');
  giveBlue(g, g.players[4], 'piety');
  const bad = [
    { action: 'play', card: 99999, target: 1 },
    { action: 'play', card: acc.id, target: 0 }, // กล่าวหาตัวเอง
    { action: 'play', card: acc.id, target: 4 }, // มีความศรัทธา
    { action: 'play', card: acc.id, target: 42 },
    { action: 'play', card: acc.id, target: 1, power: true }, // ไม่ใช่อบิเกล
    { action: 'play', card: stocks.id, target: 2 }, // ออสบอร์นไม่โดนขื่อคา
    { action: 'play', card: rob.id, target: 3, target2: 0 }, // มาร์ธาไม่โดนปล้น
    { action: 'play', card: rob.id, target: 1, target2: 1 },
    { action: 'draw3' }, // ไม่ใช่แมรี
    { action: 'end' }, // ต้องจั่วหรือเล่นก่อน
    { action: 'power', target: 1 },
    { action: 'fly' },
    null, 'x', 42,
  ];
  for (const a of bad) assert.strictEqual(g.submit('p0', e.id, a), 'การเลือกไม่ถูกต้อง', JSON.stringify(a));
  assert.strictEqual(g.submit('p0', e.id + 1, { action: 'draw' }), 'คำสั่งนี้หมดอายุแล้ว');
  assert.strictEqual(g.submit('p1', e.id, { action: 'draw' }), 'คำสั่งนี้หมดอายุแล้ว', 'someone else cannot answer my prompt');
  assert.strictEqual(g.pending.get('p0'), e, 'prompt still pending');
  assert.strictEqual(g.submit('p0', e.id, { action: 'play', card: stocks.id, target: 1 }), null);
  e = await waitPrompt(g, 'p0', 'turn');
  assert.ok(e.req.played);
  assert.strictEqual(g.submit('p0', e.id, { action: 'draw' }), 'การเลือกไม่ถูกต้อง', 'cannot draw after playing');
  assert.ok(g.players[1].stocked);
  assert.strictEqual(g.submit('p0', e.id, { action: 'end' }), null);
  } finally {
    g.abort();
    await run;
  }
});

test('views never leak hidden information', async () => {
  const g = new Game({
    players: players(6), botDelay: 0,
    rig: (g) => setTryals(g, [['nw', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['w', 'nw', 'nw', 'nw', 'nw'], ['c', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw'], ['nw', 'nw', 'nw', 'nw', 'nw']]),
  });
  const town = g.viewFor('p0');
  const witch = g.viewFor('p1');
  for (const p of town.players) {
    if (p.seat === 0) { assert.ok(p.tryal.every((c) => c.kind)); continue; }
    assert.ok(p.tryal.every((c) => !('kind' in c)), 'town player cannot see other hidden cards');
    assert.strictEqual(p.witch, null, 'town player cannot see who is a witch');
    assert.ok(!('hand' in p));
  }
  assert.strictEqual(witch.players[2].witch, true, 'witches see each other');
  assert.strictEqual(witch.players[3].witch, null, 'witches do not learn town roles');
  assert.ok(witch.players[3].tryal.every((c) => !('kind' in c)), 'witches do not see the constable');
  assert.strictEqual(town.hand.length, 3);
  const json = JSON.stringify(town);
  for (const p of g.players.slice(1)) for (const c of p.hand) assert.ok(!json.includes(`"id":${c.id},"type"`), 'other players\' hand cards never appear in my view');
});
