const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload, publicUrlFor } = require('../upload');
const { notify } = require('./notifications');

const router = express.Router();
const auth = requireAuth(db);

function serializePost(row, userId) {
  const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(row.id).c;
  const liked = !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, userId);
  const tips = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM post_tips WHERE post_id = ?').get(row.id).t;
  const comments = db.prepare(`
    SELECT pc.id, pc.text, pc.created_at, u.name as who
    FROM post_comments pc JOIN users u ON u.id = pc.user_id
    WHERE pc.post_id = ? ORDER BY pc.created_at ASC
  `).all(row.id);
  const author = db.prepare('SELECT name, avatar_color FROM users WHERE id = ?').get(row.user_id);
  return {
    id: row.id,
    who: author ? author.name : 'Unknown',
    avatarBg: author ? author.avatar_color : '#6C4FF5',
    text: row.text,
    img: row.image_url,
    audience: row.audience,
    createdAt: row.created_at,
    likes: likeCount,
    liked,
    tips,
    comments,
  };
}

// GET /api/posts — feed, newest first
router.get('/', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100').all();
  res.json({ posts: rows.map((r) => serializePost(r, req.user.id)) });
});

// POST /api/posts — create (multipart: text, audience, image?)
router.post('/', auth, upload.single('image'), (req, res) => {
  const text = (req.body.text || '').slice(0, 2000);
  const audience = ['Public', 'Friends', 'Close Friends'].includes(req.body.audience) ? req.body.audience : 'Public';
  if (!text && !req.file) return res.status(400).json({ error: 'Post needs text or an image' });

  const id = nanoid();
  const imageUrl = req.file ? publicUrlFor(req, req.file.filename) : null;
  db.prepare('INSERT INTO posts (id, user_id, text, image_url, audience) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, text, imageUrl, audience);

  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  res.status(201).json({ post: serializePost(row, req.user.id) });
});

// POST /api/posts/:id/like — toggle
router.post('/:id/like', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
    if (post.user_id !== req.user.id) notify(post.user_id, '❤️', `${req.user.name} liked your post`);
  }
  res.json({ post: serializePost(post, req.user.id) });
});

// POST /api/posts/:id/comments — { text }
router.post('/:id/comments', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const text = (req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Comment text required' });

  db.prepare('INSERT INTO post_comments (id, post_id, user_id, text) VALUES (?, ?, ?, ?)')
    .run(nanoid(), post.id, req.user.id, text);
  if (post.user_id !== req.user.id) notify(post.user_id, '💬', `${req.user.name} commented on your post`);

  res.status(201).json({ post: serializePost(post, req.user.id) });
});

// POST /api/posts/:id/tip — { amount }
router.post('/:id/tip', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const amount = Number(req.body.amount) || 1;
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });
  if (req.user.pi_balance < amount) return res.status(400).json({ error: 'Insufficient Pi balance' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET pi_balance = pi_balance - ? WHERE id = ?').run(amount, req.user.id);
    if (post.user_id !== req.user.id) {
      db.prepare('UPDATE users SET pi_balance = pi_balance + ? WHERE id = ?').run(amount, post.user_id);
    }
    db.prepare('INSERT INTO post_tips (id, post_id, from_user_id, amount) VALUES (?, ?, ?, ?)')
      .run(nanoid(), post.id, req.user.id, amount);
    db.prepare('INSERT INTO wallet_history (id, user_id, label, amount) VALUES (?, ?, ?, ?)')
      .run(nanoid(), req.user.id, `Tipped ${post.text ? post.text.slice(0, 24) : 'a post'}`, -amount);
    if (post.user_id !== req.user.id) {
      db.prepare('INSERT INTO wallet_history (id, user_id, label, amount) VALUES (?, ?, ?, ?)')
        .run(nanoid(), post.user_id, `Received tip from ${req.user.name}`, amount);
      notify(post.user_id, '🥧', `You received a π${amount} tip from ${req.user.name}`);
    }
  });
  tx();

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ post: serializePost(post, req.user.id), piBalance: updatedUser.pi_balance });
});

module.exports = router;
