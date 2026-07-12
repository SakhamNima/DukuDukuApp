const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload, publicUrlFor } = require('../upload');

const router = express.Router();
const auth = requireAuth(db);

function serialize(row, userId) {
  const author = db.prepare('SELECT name, avatar_color FROM users WHERE id = ?').get(row.user_id);
  const seen = !!db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND user_id = ?').get(row.id, userId);
  return {
    id: row.id,
    name: author ? author.name : 'Unknown',
    img: row.image_url,
    cap: row.caption,
    audience: row.audience,
    seen,
    createdAt: row.created_at,
  };
}

// GET /api/stories — active (not expired), newest first
router.get('/', auth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM stories WHERE expires_at > datetime('now') ORDER BY created_at DESC LIMIT 100`).all();
  res.json({ stories: rows.map((r) => serialize(r, req.user.id)) });
});

// POST /api/stories — multipart: caption, audience, image?
router.post('/', auth, upload.single('image'), (req, res) => {
  const caption = (req.body.caption || '').slice(0, 300);
  const audience = ['Everyone', 'Close Friends'].includes(req.body.audience) ? req.body.audience : 'Everyone';
  const id = nanoid();
  const imageUrl = req.file ? publicUrlFor(req, req.file.filename) : null;
  db.prepare('INSERT INTO stories (id, user_id, image_url, caption, audience) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, imageUrl, caption, audience);
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  res.status(201).json({ story: serialize(row, req.user.id) });
});

// POST /api/stories/:id/view — mark seen
router.post('/:id/view', auth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found' });
  db.prepare('INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)').run(story.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
