const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('./notifications');

const router = express.Router();
const auth = requireAuth(db);

router.get('/', auth, (req, res) => {
  const history = db.prepare('SELECT * FROM wallet_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
  res.json({ piBalance: req.user.pi_balance, history });
});

// POST /api/wallet/tip — { targetHandle, amount }  (free-form "send to anyone" demo transfer)
router.post('/tip', auth, (req, res) => {
  const amount = Number(req.body.amount) || 0;
  const targetHandle = (req.body.targetHandle || '').trim();
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });
  if (req.user.pi_balance < amount) return res.status(400).json({ error: 'Insufficient Pi balance' });

  const targetUser = targetHandle ? db.prepare('SELECT * FROM users WHERE handle = ? OR name = ?').get(targetHandle, targetHandle) : null;

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET pi_balance = pi_balance - ? WHERE id = ?').run(amount, req.user.id);
    db.prepare('INSERT INTO wallet_history (id, user_id, label, amount) VALUES (?, ?, ?, ?)')
      .run(nanoid(), req.user.id, `Sent tip to ${targetHandle || 'someone'}`, -amount);
    if (targetUser) {
      db.prepare('UPDATE users SET pi_balance = pi_balance + ? WHERE id = ?').run(amount, targetUser.id);
      db.prepare('INSERT INTO wallet_history (id, user_id, label, amount) VALUES (?, ?, ?, ?)')
        .run(nanoid(), targetUser.id, `Received tip from ${req.user.name}`, amount);
      notify(targetUser.id, '🥧', `You received a π${amount} tip from ${req.user.name}`);
    }
  });
  tx();

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const history = db.prepare('SELECT * FROM wallet_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
  res.json({ piBalance: updated.pi_balance, history });
});

module.exports = router;
