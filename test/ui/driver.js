'use strict';

// ตัวช่วยควบคุมหน้าเว็บผ่าน Playwright (ใช้ร่วมกันระหว่างการทดสอบและสคริปต์ถ่ายภาพหน้าจอ)

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createServer } = require('../../server');

const OUT = path.join(__dirname, '..', '..', 'test-results');
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

function launchOpts() {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return exe && fs.statSync(exe).isFile() ? { executablePath: exe } : {};
}
const launch = () => chromium.launch(launchOpts());

async function startServer(opts = {}) {
  const ctx = createServer({ botDelay: 60, talkDelay: 40, pace: 0.05, timeouts: { turn: 30000, quick: 30000, disconnected: 12000 }, ...opts });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  ctx.url = `http://127.0.0.1:${ctx.server.address().port}/`;
  ctx.close = async () => {
    for (const r of ctx.rooms.rooms.values()) ctx.rooms.destroy(r);
    ctx.io.close();
    await new Promise((r) => ctx.server.close(r));
  };
  return ctx;
}

/** หน้าใหม่ที่เก็บ error ของ JS ไว้ (ฟอนต์จาก Google ถูกแทนด้วย CSS ว่าง เพื่อให้ทดสอบได้แบบออฟไลน์) */
async function newPage(browser, kind) {
  const context = await browser.newContext(VIEWPORTS[kind]);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.context_ = context;
  return page;
}

/** ตรวจเลย์เอาต์: ไม่มีเลื่อนแนวนอน, ข้อความไม่ล้น, ที่นั่งไม่ล้นจอและไม่ทับกัน */
async function checkLayout(page, label) {
  const r = await page.evaluate(() => {
    const over = [...document.querySelectorAll('.cf-name, .cf-type, .cf-text, .cf-state, .seat .nm, .seat .pl, .seat .row2, .chip, .arrowtag, .pile b, .top .turn')]
      .filter((e) => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1))
      .map((e) => `${e.className}: ${e.textContent.trim().slice(0, 30)}`);
    const seats = [...document.querySelectorAll('.seat')].map((e) => e.getBoundingClientRect());
    let overlap = 0;
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i]; const b = seats[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
    }
    const outside = seats.filter((s) => s.left < -1 || s.right > innerWidth + 1).length;
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over, overlap, outside };
  });
  assert.ok(r.sw <= r.cw, `${label}: no horizontal page scroll (${r.sw} > ${r.cw})`);
  assert.deepStrictEqual(r.over, [], `${label}: text overflows`);
  assert.strictEqual(r.outside, 0, `${label}: seats stay on screen`);
  assert.strictEqual(r.overlap, 0, `${label}: seats do not overlap`);
}

async function createRoom(page, url, name, bots) {
  await page.goto(url);
  await page.fill('#name', name);
  await page.click('[data-act="create"]');
  await page.waitForSelector('[data-act="addBot"]');
  for (let i = 0; i < bots; i++) {
    await page.click('[data-act="addBot"]');
    await page.waitForFunction((n) => document.querySelectorAll('.pl').length === n, i + 2);
  }
}

/** ตอบคำสั่งที่รออยู่หนึ่งครั้งผ่านปุ่มบนหน้าจอ คืน 'over' เมื่อเกมจบ */
async function step(page, st) {
  if (await page.locator('.modal .rtitle').count()) return 'over';
  const prompt = page.locator('.prompt:not(.wait)');
  if (!(await prompt.count())) return 'idle';
  const click = async (sel) => { const l = page.locator(sel); if (await l.count()) { await l.first().click(); return true; } return false; };
  const text = await prompt.first().innerText();
  if (text.includes('ดูผลเกม')) { await click('[data-act="showResult"]'); return 'acted'; }
  if (text.startsWith('ตาของคุณ')) {
    if (!text.includes('จบตา') && st.turnPlays === 0) {
      const red = page.locator('.hand .card[data-act="hand"][data-type="accusation"], .hand .card[data-act="hand"][data-type="evidence"]');
      if (await red.count()) {
        await red.first().click();
        if (await click('.seat.pick')) { st.turnPlays++; st.plays++; return 'acted'; }
        await click('[data-act="cancel"]');
      }
    }
    st.turnPlays = 0;
    if (await click('[data-act="end"]')) return 'acted';
    await click('[data-act="draw"]');
    st.draws++;
    return 'acted';
  }
  if (text.startsWith('เล่น「') || text.startsWith('✨')) { if (!(await click('.seat.pick'))) await click('[data-act="cancel"]'); return 'acted'; }
  if (await click('[data-act="idx"]')) return 'acted';
  if (await click('[data-act="vote"]')) { st.night++; return 'acted'; }
  if (await click('[data-act="confess"][data-idx="none"]')) { st.night++; return 'acted'; }
  if (await click('[data-act="bribeNo"]')) return 'acted';
  if (text.includes('ทิ้งการ์ด 1 ใบ')) { await click('.hand .card[data-act="hand"]'); await click('[data-act="discard1"]'); return 'acted'; }
  if (text.includes('ทำนาย')) {
    for (let i = 0; i < 3; i++) await click('[data-act="tit"]:not(.picked)');
    await click('[data-act="titOk"]');
    return 'acted';
  }
  return 'idle';
}

async function playToEnd(page, { maxMs = 240000, onTick } = {}) {
  const st = { plays: 0, draws: 0, turnPlays: 0, night: 0, ticks: 0 };
  const t0 = Date.now();
  for (;;) {
    const r = await step(page, st);
    if (r === 'over') return st;
    st.ticks++;
    if (onTick) await onTick(st);
    if (Date.now() - t0 > maxMs) throw new Error('game did not finish in time');
    await page.waitForTimeout(r === 'acted' ? 60 : 120);
  }
}

module.exports = { OUT, VIEWPORTS, launch, startServer, newPage, checkLayout, createRoom, step, playToEnd };
