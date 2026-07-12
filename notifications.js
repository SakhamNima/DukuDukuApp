const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const auth = requireAuth(db);

// Set by server.js once Socket.IO is initialised, so `notify()` can push
// realtime events in addition to writing the row.
let io = null;
function attachIo(ioInstance) { io = ioInstance; }

function notify(userId, icon, text) {
  const id = nanoid();
  db.prepare('INSERT INTO notifications (id, user_id, icon, text) VALUES (?, ?, ?, ?)').run(id, userId, icon, text);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (io) io.to(`user:${userId}`).emit('notification', row);
  return row;
}

router.get('/', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ notifications: rows });
});

router.post('/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET unread = 0 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = { router, notify, attachIo };
