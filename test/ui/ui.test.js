'use strict';

// เปิดหน้าเว็บจริงใน Chromium (เดสก์ท็อป 1280×800 + มือถือ 400px) เล่นจนจบ ตรวจ JS error และเลย์เอาต์

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CARDS } = require('../../server/game/cards');
const { OUT, launch, startServer, newPage, checkLayout, createRoom, playToEnd } = require('./driver');

fs.mkdirSync(OUT, { recursive: true });

for (const kind of ['desktop', 'phone']) {
  test(`${kind}: full game through the real UI, refresh-rejoin, results and play again`, { timeout: 300000 }, async () => {
    const srv = await startServer();
    const browser = await launch();
    try {
      const page = await newPage(browser, kind);
      await createRoom(page, srv.url, 'สมชาย', kind === 'phone' ? 7 : 6);
      await checkLayout(page, `${kind} lobby`);
      await page.screenshot({ path: path.join(OUT, `${kind}-1-lobby.png`), fullPage: true });
      await page.click('[data-act="start"]');
      await page.waitForSelector('.seat.me');
      await page.waitForTimeout(400);
      await checkLayout(page, `${kind} table`);
      assert.strictEqual(await page.locator('.seat.me .sbadge').innerText(), 'คุณ');
      await page.screenshot({ path: path.join(OUT, `${kind}-2-table.png`), fullPage: true });

      // รีเฟรชกลางเกม: กลับมาที่นั่งเดิม
      const mySeat = await page.locator('.seat.me').getAttribute('data-seat');
      const myChar = await page.locator('.seat.me .nm').innerText();
      await page.reload();
      await page.waitForSelector('.seat.me');
      assert.strictEqual(await page.locator('.seat.me').getAttribute('data-seat'), mySeat, 'same seat after refresh');
      assert.strictEqual(await page.locator('.seat.me .nm').innerText(), myChar);

      // แตะการ์ดในมือ → หน้าต่างกติกาเต็ม
      // (บอทอาจปล้น/เผาการ์ดในมือไปแล้ว จึงใช้การ์ดตัวละครแทนถ้ามือว่าง)
      const info = page.locator('.hand .card .info, .myroles .card[data-info^="char:"]');
      await info.first().click();
      await page.waitForSelector('.modal h2');
      await page.screenshot({ path: path.join(OUT, `${kind}-3-card-info.png`) });
      await page.click('.modal [data-act="close"]');

      // แชท
      await page.fill('#chatin', 'ฉันไม่ใช่แม่มดนะ ใครน่าสงสัย?');
      await page.press('#chatin', 'Enter');
      await page.waitForFunction(() => [...document.querySelectorAll('.msg.mine .tx')].some((e) => e.textContent.includes('ใครน่าสงสัย')));

      let shotMid = false;
      const st = await playToEnd(page, {
        onTick: async (s) => {
          if (!shotMid && s.plays + s.draws >= 3) {
            shotMid = true;
            await checkLayout(page, `${kind} mid-game`);
            await page.screenshot({ path: path.join(OUT, `${kind}-4-midgame.png`), fullPage: true });
          }
        },
      });
      assert.ok(st.plays + st.draws + st.night > 0, 'the human actually played through the UI');
      await page.waitForSelector('.modal .rtitle');
      await page.screenshot({ path: path.join(OUT, `${kind}-5-results.png`) });
      const title = await page.locator('.modal .rtitle').innerText();
      assert.match(title, /ชาวเมืองชนะ|แม่มดชนะ/);
      await page.click('[data-act="toLobby"]');
      await page.waitForSelector('[data-act="start"]');
      await checkLayout(page, `${kind} back in lobby`);
      assert.deepStrictEqual(page.errors, [], 'no JS errors');
      await page.context_.close();
    } finally {
      await browser.close();
      await srv.close();
    }
  });
}

test('layout holds for every player count 4–12 on phone and desktop; gallery redraw matches', { timeout: 300000 }, async () => {
  const srv = await startServer({ botDelay: 2000 });
  const browser = await launch();
  try {
    for (const kind of ['phone', 'desktop']) {
      const page = await newPage(browser, kind);
      for (let n = 4; n <= 12; n++) {
        await createRoom(page, srv.url, 'ทดสอบ', n - 1);
        await page.click('[data-act="start"]');
        await page.waitForSelector('.seat.me');
        await page.waitForTimeout(150);
        await checkLayout(page, `${kind} ${n} players`);
        if (n === 12) {
          await page.screenshot({ path: path.join(OUT, `${kind}-12-players.png`), fullPage: true });
          // ทุกชนิดการ์ดบนกองทิ้งต้องแสดงชื่อได้พอดี
          const room = [...srv.rooms.rooms.values()].pop();
          for (const type of Object.keys(CARDS)) {
            room.game.discard.push({ id: 900000, type });
            srv.rooms.broadcast(room);
            await page.waitForFunction((t) => document.querySelector('.pile.discard b') && document.querySelector('.pile.discard b').textContent === t, CARDS[type].name);
            await checkLayout(page, `${kind} discard top ${type}`);
            room.game.discard.pop();
          }
        }
        page.once('dialog', (d) => d.accept());
        await page.click('.top [data-act="leave"]');
        await page.waitForSelector('[data-act="create"]');
      }
      await page.goto(`${srv.url}gallery.html`);
      await page.waitForSelector('.item');
      await checkLayout(page, `${kind} gallery`);
      for (const tab of ['cards', 'tryal', 'chars', 'misc']) {
        await page.click(`[data-tab="${tab}"]`);
        if (!(await page.locator('#live').isChecked())) await page.check('#live');
        await page.waitForFunction(() => document.querySelectorAll('[data-chk]').length && [...document.querySelectorAll('[data-chk]')].every((e) => /ok|bad/.test(e.className)));
        const bad = await page.locator('[data-chk].bad').count();
        assert.strictEqual(bad, 0, `${kind} gallery ${tab}: live redraw matches the saved files`);
        await checkLayout(page, `${kind} gallery ${tab}`);
        if (tab === 'chars') await page.screenshot({ path: path.join(OUT, `${kind}-6-gallery.png`), fullPage: kind === 'phone' ? false : true });
      }
      assert.deepStrictEqual(page.errors, [], `${kind}: no JS errors`);
      await page.context_.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
