'use strict';

// สร้างภาพประกอบทั้งหมดจากโค้ด แล้วบันทึกถาวรที่ public/art/ พร้อม manifest + ลายนิ้วมือ SHA-256
// ใช้: npm run build:art   (ตรวจอย่างเดียว: npm run build:art -- --check)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const designs = require('../public/artgen/designs');
const { encodePNG } = require('./png');

const ART_DIR = path.join(__dirname, '..', 'public', 'art');

function allSlots() {
  return [
    ...designs.CARD_KEYS.map((id) => ['cards', id]),
    ...designs.TRYAL_KEYS.map((id) => ['tryal', id]),
    ...designs.CHAR_KEYS.map((id) => ['chars', id]),
    ...designs.MISC_KEYS.map((id) => ['misc', id]),
  ];
}

function buildAll() {
  const files = {};
  for (const [kind, id] of allSlots()) files[`${kind}/${id}.png`] = encodePNG(designs.render(kind, id));
  return files;
}

function manifestFor(files) {
  const items = {};
  const sha256 = {};
  for (const [rel, buf] of Object.entries(files)) {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    sha256[rel] = hash;
    items[rel.replace(/\.png$/, '')] = `${rel}?v=${hash.slice(0, 10)}`;
  }
  return { generator: `artgen v${designs.VERSION}`, note: 'สร้างอัตโนมัติจาก public/artgen — ห้ามแก้ด้วยมือ', items, sha256 };
}

function main() {
  const check = process.argv.includes('--check');
  const files = buildAll();
  const manifest = manifestFor(files);
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  if (check) {
    let bad = 0;
    for (const [rel, buf] of Object.entries(files)) {
      const p = path.join(ART_DIR, rel);
      if (!fs.existsSync(p) || !fs.readFileSync(p).equals(buf)) { console.error(`✗ ${rel} ไม่ตรงกับตัวสร้างภาพ`); bad++; }
    }
    const mp = path.join(ART_DIR, 'manifest.json');
    if (!fs.existsSync(mp) || fs.readFileSync(mp, 'utf8') !== manifestText) { console.error('✗ manifest.json ไม่ตรง'); bad++; }
    if (bad) { console.error(`พบ ${bad} ไฟล์ไม่ตรง — รัน npm run build:art`); process.exit(1); }
    console.log(`✓ ภาพทั้ง ${Object.keys(files).length} ไฟล์ตรงกับตัวสร้างภาพ`);
    return;
  }
  fs.rmSync(ART_DIR, { recursive: true, force: true });
  for (const [rel, buf] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(ART_DIR, rel)), { recursive: true });
    fs.writeFileSync(path.join(ART_DIR, rel), buf);
  }
  fs.writeFileSync(path.join(ART_DIR, 'manifest.json'), manifestText);
  const total = Object.values(files).reduce((s, b) => s + b.length, 0);
  console.log(`สร้างภาพ ${Object.keys(files).length} ไฟล์ (${(total / 1024).toFixed(0)} KB) ที่ public/art/`);
}

if (require.main === module) main();
module.exports = { buildAll, manifestFor, allSlots, ART_DIR };
