'use strict';

const crypto = require('crypto');
const { Game, MIN_PLAYERS, MAX_PLAYERS, THRESHOLD } = require('./game/engine');
const { CARDS, COLORS, TRYALS, TRYAL_TABLE, CHARACTERS } = require('./game/cards');
const talk = require('./game/talk');

const META = { cards: CARDS, colors: COLORS, tryals: TRYALS, tryalTable: TRYAL_TABLE, characters: CHARACTERS, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, threshold: THRESHOLD };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['บอทมะลิ', 'บอทจำปา', 'บอทกุหลาบ', 'บอทพิกุล', 'บอทลำดวน', 'บอทชบา', 'บอทบัว', 'บอทแก้ว', 'บอทเข็ม', 'บอทยี่โถ', 'บอทราตรี', 'บอทพุด'];
const ROOM_IDLE_MS = 30 * 60 * 1000;

const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'ผู้เล่น';

class RoomManager {
  constructor(io, opts = {}) {
    this.io = io;
    this.opts = opts;
    this.rooms = new Map();
    this.tokens = new Map(); // token -> room code
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  createRoom() {
    const room = { code: this.newCode(), players: [], hostPid: null, status: 'lobby', game: null, chat: [], lastActive: Date.now(), timer: null, talkTimers: new Set() };
    this.rooms.set(room.code, room);
    return room;
  }

  lookup(token) {
    const code = token && this.tokens.get(token);
    const room = code && this.rooms.get(code);
    const pl = room && room.players.find((p) => p.token === token);
    return pl ? { room, pl } : { room: null, pl: null };
  }

  handle(socket) {
    let token = null;
    socket.emit('meta', META);
    const toast = (msg) => socket.emit('toast', msg);
    const on = (ev, fn) => socket.on(ev, (data = {}) => {
      try { fn(data || {}); } catch (e) { console.error(`socket ${ev} error`, e); toast('เกิดข้อผิดพลาด'); }
    });

    on('hello', ({ token: t }) => {
      if (typeof t !== 'string' || t.length < 8 || t.length > 100) return toast('token ไม่ถูกต้อง');
      token = t;
      const { room, pl } = this.lookup(token);
      if (room) this.attach(room, pl, socket);
      else socket.emit('state', { now: Date.now(), room: null });
    });

    on('create', ({ name }) => {
      if (!token) return;
      this.leaveCurrent(token);
      const room = this.createRoom();
      const pl = this.addHuman(room, token, name);
      this.attach(room, pl, socket);
    });

    on('join', ({ code, name }) => {
      if (!token) return;
      code = String(code || '').toUpperCase().trim();
      const room = this.rooms.get(code);
      if (!room) return toast('ไม่พบห้องนี้');
      const existing = room.players.find((p) => p.token === token);
      if (existing) return this.attach(room, existing, socket);
      if (room.status !== 'lobby') return toast('เกมในห้องนี้เริ่มไปแล้ว');
      if (room.players.length >= MAX_PLAYERS) return toast('ห้องเต็มแล้ว');
      this.leaveCurrent(token);
      const pl = this.addHuman(room, token, name);
      this.sysChat(room, `${pl.name} เข้าห้อง`);
      this.attach(room, pl, socket);
    });

    on('leave', () => {
      if (!token) return;
      this.leaveCurrent(token);
      socket.emit('state', { now: Date.now(), room: null });
    });

    on('rename', ({ name }) => {
      const { room, pl } = this.lookup(token);
      if (!room || room.status !== 'lobby') return;
      pl.name = cleanName(name);
      this.broadcast(room);
    });

    on('addBot', () => {
      const { room, pl } = this.lookup(token);
      if (!room || room.hostPid !== pl.pid || room.status !== 'lobby') return;
      if (room.players.length >= MAX_PLAYERS) return toast('ห้องเต็มแล้ว');
      const used = new Set(room.players.map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) || `บอท${room.players.length + 1}`;
      room.players.push({ pid: crypto.randomUUID(), token: null, name, isBot: true, connected: true, socketId: null });
      this.broadcast(room);
    });

    on('kick', ({ pid }) => {
      const { room, pl } = this.lookup(token);
      if (!room || room.hostPid !== pl.pid || room.status !== 'lobby' || pid === pl.pid) return;
      const target = room.players.find((p) => p.pid === pid);
      if (!target) return;
      this.removePlayer(room, target);
      if (target.socketId) this.io.to(target.socketId).emit('state', { now: Date.now(), room: null, kicked: true });
      this.broadcast(room);
    });

    on('start', () => {
      const { room, pl } = this.lookup(token);
      if (!room || room.hostPid !== pl.pid || room.status !== 'lobby') return;
      if (room.players.length < MIN_PLAYERS) return toast(`ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน (เพิ่มบอทได้)`);
      this.startGame(room);
    });

    on('answer', ({ promptId, data }) => {
      const { room, pl } = this.lookup(token);
      if (!room || !room.game) return;
      const err = room.game.submit(pl.pid, promptId, data);
      if (err) { toast(err); this.sendState(room, pl); }
    });

    on('chat', ({ text, scope }) => {
      const { room, pl } = this.lookup(token);
      if (!room) return;
      const t = String(text || '').trim().slice(0, 200);
      if (!t) return;
      const g = room.game;
      const gp = g && g.player(pl.pid);
      if (scope === 'witch') {
        if (!gp || !gp.witch || g.phase === 'over') return toast('ช่องแม่มดใช้ได้เฉพาะแม่มดระหว่างเกม');
        this.pushChat(room, { from: pl.name, seat: gp.seat, text: t, scope: 'witch' });
      } else {
        this.pushChat(room, { from: pl.name, seat: gp ? gp.seat : null, text: t, scope: 'all' });
        if (g && gp && room.status === 'playing') this.botLines(room, talk.reply(g, gp, t), true);
      }
      this.broadcast(room);
    });

    on('toLobby', () => {
      const { room, pl } = this.lookup(token);
      if (!room || room.hostPid !== pl.pid || room.status !== 'ended') return;
      room.game = null;
      room.status = 'lobby';
      room.players = room.players.filter((p) => !p.left);
      this.sysChat(room, 'กลับห้องรอ — พร้อมเล่นอีกรอบ');
      this.broadcast(room);
    });

    socket.on('disconnect', () => {
      const { room, pl } = this.lookup(token);
      if (!pl || pl.socketId !== socket.id) return;
      pl.connected = false;
      pl.socketId = null;
      if (room.game) room.game.setConnected(pl.pid, false);
      this.broadcast(room);
    });
  }

  addHuman(room, token, name) {
    const pl = { pid: crypto.randomUUID(), token, name: cleanName(name), isBot: false, connected: true, socketId: null };
    room.players.push(pl);
    if (!room.hostPid) room.hostPid = pl.pid;
    this.tokens.set(token, room.code);
    return pl;
  }

  attach(room, pl, socket) {
    if (pl.socketId && pl.socketId !== socket.id) {
      this.io.to(pl.socketId).emit('state', { now: Date.now(), room: null, replaced: true });
    }
    const wasAway = !pl.connected;
    pl.socketId = socket.id;
    pl.connected = true;
    room.lastActive = Date.now();
    if (room.game) room.game.setConnected(pl.pid, true);
    if (wasAway && room.status === 'playing') this.sysChat(room, `${pl.name} กลับเข้าเกม`);
    this.broadcast(room);
  }

  leaveCurrent(token) {
    const { room, pl } = this.lookup(token);
    if (!room) return;
    this.tokens.delete(token);
    if (room.status === 'lobby') {
      this.removePlayer(room, pl);
      this.sysChat(room, `${pl.name} ออกจากห้อง`);
    } else {
      // ระหว่างเกม: ให้บอทเล่นแทนถาวร
      pl.left = true;
      pl.token = null;
      pl.socketId = null;
      pl.connected = false;
      if (room.game) room.game.setBot(pl.pid);
      this.sysChat(room, `${pl.name} ออกจากเกม (บอทเล่นแทน)`);
      if (room.hostPid === pl.pid) this.pickHost(room);
    }
    if (!room.players.some((p) => !p.isBot && !p.left)) this.destroy(room);
    else this.broadcast(room);
  }

  removePlayer(room, pl) {
    room.players = room.players.filter((p) => p !== pl);
    if (pl.token) this.tokens.delete(pl.token);
    if (room.hostPid === pl.pid) this.pickHost(room);
  }

  pickHost(room) {
    const h = room.players.find((p) => !p.isBot && !p.left);
    room.hostPid = h ? h.pid : null;
  }

  destroy(room) {
    if (room.game) room.game.abort();
    for (const p of room.players) if (p.token) this.tokens.delete(p.token);
    clearTimeout(room.timer);
    for (const t of room.talkTimers) clearTimeout(t);
    this.rooms.delete(room.code);
  }

  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p.connected && !p.isBot)) { room.lastActive = now; continue; }
      if (now - room.lastActive > (this.opts.roomIdleMs || ROOM_IDLE_MS)) this.destroy(room);
    }
  }

  startGame(room) {
    room.players = room.players.filter((p) => !p.left);
    room.status = 'playing';
    room.chat = room.chat.filter((m) => m.scope !== 'witch').slice(-20);
    const game = new Game({
      players: room.players.map((p) => ({ pid: p.pid, name: p.name, isBot: p.isBot })),
      onUpdate: () => this.broadcast(room),
      onEvent: (ev) => { if (room.game === game) this.botLines(room, talk.react(game, ev)); },
      botDelay: this.opts.botDelay ?? 900,
      timeouts: this.opts.timeouts,
      maxTurns: this.opts.maxTurns,
      firstSeat: this.opts.firstSeat,
    });
    for (const p of room.players) if (!p.isBot && !p.connected) game.setConnected(p.pid, false);
    room.game = game;
    this.sysChat(room, 'เริ่มเกม! ระวังแม่มดที่ซ่อนอยู่ในหมู่พวกเรา…');
    game.run().then(() => {
      if (room.game !== game) return;
      room.status = 'ended';
      this.broadcast(room);
    });
    this.broadcast(room);
  }

  /** บอทพูดในแชทหลังหน่วงเวลาเล็กน้อย (ให้ดูเป็นธรรมชาติ) */
  botLines(room, lines, force = false) {
    const game = room.game;
    const base = this.opts.talkDelay ?? Math.min(1400, (this.opts.botDelay ?? 900) * 1.2);
    // จำกัดความถี่: บอทแต่ละตัวพูดได้ทุก ~9 วินาที และทั้งห้องไม่เกิน 1 ประโยคต่อ ~2.5 วินาที (ยกเว้นตอบคนหรือคุยในช่องแม่มด)
    const at = Date.now();
    room.botSaid = room.botSaid || {};
    lines = lines.filter((l) => {
      if (!force && l.scope !== 'witch') {
        if ((room.botSaid[l.seat] || 0) > at - 9000 || (room.lastBotAt || 0) > at - 2500) return false;
        room.lastBotAt = at;
      }
      room.botSaid[l.seat] = at;
      return true;
    });
    lines.forEach((l, i) => {
      const t = setTimeout(() => {
        room.talkTimers.delete(t);
        if (!this.rooms.has(room.code) || room.game !== game) return;
        const p = game.players[l.seat];
        if (!p || !p.isBot) return;
        this.pushChat(room, { from: p.name, seat: p.seat, text: l.text, scope: l.scope || 'all', bot: true });
        this.broadcast(room);
      }, base * (0.6 + Math.random() * 0.8) + i * base);
      room.talkTimers.add(t);
    });
  }

  pushChat(room, msg) {
    room.chat.push({ id: crypto.randomUUID(), at: Date.now(), scope: 'all', ...msg });
    if (room.chat.length > 150) room.chat.shift();
  }
  sysChat(room, text) { this.pushChat(room, { from: null, text }); }

  stateFor(room, pl) {
    const g = room.game;
    const gp = g && g.player(pl.pid);
    const seeWitch = !!(g && (g.phase === 'over' || (gp && gp.witch)));
    return {
      now: Date.now(),
      me: pl.pid,
      room: {
        code: room.code,
        hostPid: room.hostPid,
        status: room.status,
        players: room.players.filter((p) => !p.left || room.status !== 'lobby').map((p) => ({
          pid: p.pid, name: p.name, isBot: p.isBot, connected: p.connected, left: !!p.left,
        })),
        chat: room.chat.filter((m) => m.scope !== 'witch' || seeWitch).slice(-60),
      },
      game: g ? g.viewFor(pl.pid) : null,
    };
  }

  sendState(room, pl) {
    if (pl.socketId) this.io.to(pl.socketId).emit('state', this.stateFor(room, pl));
  }

  broadcast(room) {
    if (room.timer) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      for (const pl of room.players) this.sendState(room, pl);
    }, 25);
  }
}

module.exports = { RoomManager, META };
