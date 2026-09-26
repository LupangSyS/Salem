'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager, META } = require('./rooms');

function createServer(opts = {}) {
  const app = express();
  const publicDir = path.join(__dirname, '..', 'public');
  const server = http.createServer(app);
  const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });
  app.use(express.static(publicDir));
  app.get('/health', (req, res) => res.json({ ok: true }));
  // ฐานข้อมูลการ์ด/ตัวละคร (อ่านอย่างเดียว)
  app.get('/api/cards', (req, res) => res.json(META));
  const rooms = new RoomManager(io, opts);
  io.on('connection', (socket) => rooms.handle(socket));
  return { app, server, io, rooms };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const botDelay = process.env.BOT_DELAY !== undefined ? Number(process.env.BOT_DELAY) : undefined;
  const { server } = createServer({ botDelay });
  server.listen(port, () => console.log(`เซเลม 1692 พร้อมที่ http://localhost:${port}`));
}

module.exports = { createServer };
