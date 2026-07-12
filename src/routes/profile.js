const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { publicUser } = require('./auth');

const router = express.Router();
const auth = requireAuth(db);

router.put('/', auth, (req, res) => {
  const name = (req.body.name || req.user.name).slice(0, 40);
  const avatarColor = /^#[0-9A-Fa-f]{6}$/.test(req.body.avatarColor || '') ? req.body.avatarColor : req.user.avatar_color;
  let handle = req.user.handle;
  if (req.body.handle && req.body.handle.trim()) {
    const clean = req.body.handle.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 20);
    const taken = db.prepare('SELECT 1 FROM users WHERE handle = ? AND id != ?').get(clean, req.user.id);
    if (!taken && clean) handle = clean;
  }
  db.prepare('UPDATE users SET name = ?, handle = ?, avatar_color = ? WHERE id = ?').run(name, handle, avatarColor, req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(updated) });
});

router.post('/require-passcode', auth, (req, res) => {
  const value = req.body.value ? 1 : 0;
  db.prepare('UPDATE users SET require_passcode = ? WHERE id = ?').run(value, req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(updated) });
});

module.exports = router;
