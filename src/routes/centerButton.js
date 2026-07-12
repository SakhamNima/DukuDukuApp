const express = require('express');
const db = require('../db');
const { requireAuth, requireOwner } = require('../middleware/auth');

const router = express.Router();
const auth = requireAuth(db);

const VALID_ACTIONS = new Set([
  'create_post', 'record_video', 'start_story', 'scan_qr_connect',
  'new_channel', 'open_pi_payment', 'open_miniapps_menu',
]);

router.get('/', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM center_button WHERE id = 1').get();
  res.json({ centerButton: row });
});

// Owner-only — matches the Pi listing note that this control belongs to the app owner, not every user.
router.put('/', auth, requireOwner, (req, res) => {
  const { icon, color, label, action } = req.body;
  if (!VALID_ACTIONS.has(action)) return res.status(400).json({ error: 'Invalid action' });
  db.prepare('UPDATE center_button SET icon = ?, color = ?, label = ?, action = ? WHERE id = 1')
    .run(icon || '➕', color || '#FF5C7A', (label || 'Action').slice(0, 40), action);
  const row = db.prepare('SELECT * FROM center_button WHERE id = 1').get();
  res.json({ centerButton: row });
});

module.exports = router;
