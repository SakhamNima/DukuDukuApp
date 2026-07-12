const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const auth = requireAuth(db);

const TARGET_TYPES = ['post', 'comment', 'video', 'message', 'user'];
const REASONS = ['spam', 'harassment', 'scam_or_fraud', 'illegal', 'nudity', 'other'];

// Returns the set of user ids the current user has blocked (used to filter
// feeds elsewhere — see posts.js / videos.js).
function blockedIdsFor(userId) {
  return new Set(
    db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(userId).map((r) => r.blocked_id)
  );
}

// POST /api/moderation/report — { targetType, targetId, reason, details? }
router.post('/report', auth, (req, res) => {
  const targetType = TARGET_TYPES.includes(req.body.targetType) ? req.body.targetType : null;
  const targetId = (req.body.targetId || '').toString().slice(0, 100);
  const reason = REASONS.includes(req.body.reason) ? req.body.reason : null;
  const details = (req.body.details || '').toString().slice(0, 1000);
  if (!targetType || !targetId || !reason) {
    return res.status(400).json({ error: 'targetType, targetId and a valid reason are required' });
  }
  const id = nanoid();
  db.prepare(`
    INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, targetType, targetId, reason, details);
  res.status(201).json({ ok: true, reportId: id });
});

// GET /api/moderation/blocked — list of users I've blocked
router.get('/blocked', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.handle, u.avatar_color as avatarColor, b.created_at as blockedAt
    FROM blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC
  `).all(req.user.id);
  res.json({ blocked: rows });
});

// POST /api/moderation/block — { userId }
router.post('/block', auth, (req, res) => {
  const userId = (req.body.userId || '').toString();
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (userId === req.user.id) return res.status(400).json({ error: "You can't block yourself" });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, userId);
  res.json({ ok: true });
});

// POST /api/moderation/unblock — { userId }
router.post('/unblock', auth, (req, res) => {
  const userId = (req.body.userId || '').toString();
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, userId);
  res.json({ ok: true });
});

module.exports = { router, blockedIdsFor };
