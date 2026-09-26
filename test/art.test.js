'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildAll, manifestFor, allSlots, ART_DIR } = require('../scripts/build-art');
const { createServer } = require('../server');
const { CARDS, TRYALS, CHARACTERS } = require('../server/game/cards');

test('every card, tryal card, character, card back, token and the table has saved artwork', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8'));
  const slots = allSlots();
  const has = (kind, id) => slots.some(([k, i]) => k === kind && i === id);
  for (const id of Object.keys(CARDS)) assert.ok(has('cards', id), `art for card ${id}`);
  for (const id of Object.keys(TRYALS)) assert.ok(has('tryal', id), `art for tryal ${id}`);
  for (const id of Object.keys(CHARACTERS)) assert.ok(has('chars', id), `portrait for ${id}`);
  for (const id of ['back', 'tryalback', 'cat', 'table']) assert.ok(has('misc', id), `art for ${id}`);
  assert.strictEqual(slots.length, Object.keys(CARDS).length + Object.keys(TRYALS).length + Object.keys(CHARACTERS).length + 4, 'no orphan art');
  for (const [kind, id] of slots) {
    const rel = `${kind}/${id}.png`;
    assert.ok(manifest.items[`${kind}/${id}`], `manifest lists ${rel}`);
    const buf = fs.readFileSync(path.join(ART_DIR, rel));
    assert.strictEqual(buf.subarray(1, 4).toString('ascii'), 'PNG');
    assert.strictEqual(crypto.createHash('sha256').update(buf).digest('hex'), manifest.sha256[rel], `${rel} fingerprint`);
  }
});

test('saved artwork is exactly what the generator draws (tamper check)', () => {
  const a = buildAll();
  const b = buildAll();
  for (const rel of Object.keys(a)) assert.ok(a[rel].equals(b[rel]), `${rel} renders deterministically`);
  for (const [rel, buf] of Object.entries(a)) {
    assert.ok(fs.readFileSync(path.join(ART_DIR, rel)).equals(buf), `${rel} was modified — run npm run build:art`);
  }
  const expected = JSON.stringify(manifestFor(a), null, 2) + '\n';
  assert.strictEqual(fs.readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8'), expected, 'manifest.json is generated');
  const onDisk = fs.readdirSync(ART_DIR, { recursive: true }).filter((f) => f.endsWith('.png')).map((f) => f.split(path.sep).join('/'));
  assert.deepStrictEqual(onDisk.sort(), Object.keys(a).sort(), 'no extra images in public/art');
});

test('art, gallery and card database are read-only over HTTP', async () => {
  const { server, rooms, io } = createServer({});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const img = await fetch(`${base}/art/cards/night.png`);
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/png');
    assert.strictEqual((await fetch(`${base}/gallery.html`)).status, 200);
    const db = await (await fetch(`${base}/api/cards`)).json();
    assert.strictEqual(Object.keys(db.characters).length, 15);
    for (const [method, url] of [['PUT', '/art/cards/night.png'], ['POST', '/art/cards/night.png'], ['DELETE', '/art/cards/night.png'], ['POST', '/art/manifest.json'], ['POST', '/api/art'], ['POST', '/api/cards'], ['POST', '/upload']]) {
      const r = await fetch(base + url, { method, body: method === 'DELETE' ? undefined : 'x' });
      assert.strictEqual(r.status, 404, `${method} ${url} is not writable`);
    }
    const after = fs.readFileSync(path.join(ART_DIR, 'cards', 'night.png'));
    assert.ok(after.equals(Buffer.from(await img.arrayBuffer())));
  } finally {
    for (const r of rooms.rooms.values()) rooms.destroy(r);
    io.close();
    await new Promise((r) => server.close(r));
  }
});
