const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload, publicUrlFor } = require('../upload');
const { blockedIdsFor } = require('./moderation');

const router = express.Router();
const auth = requireAuth(db);

function serialize(row, userId) {
  const author = db.prepare('SELECT name, handle FROM users WHERE id = ?').get(row.user_id);
  const likeCount = db.prepare('SELECT COUNT(*) c FROM video_likes WHERE video_id = ?').get(row.id).c;
  const liked = !!db.prepare('SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?').get(row.id, userId);
  return {
    id: row.id,
    userId: row.user_id,
    cap: `@${author ? author.handle : 'user'} — ${row.caption || ''}`,
    media: row.media_url,
    isVideo: !!row.is_video,
    likes: likeCount,
    liked,
    comments: 0,
    shares: 0,
    createdAt: row.created_at,
  };
}

router.get('/', auth, (req, res) => {
  const blocked = blockedIdsFor(req.user.id);
  const rows = db.prepare('SELECT * FROM videos ORDER BY created_at DESC LIMIT 150')
    .all()
    .filter((r) => !blocked.has(r.user_id));
  res.json({ videos: rows.slice(0, 100).map((r) => serialize(r, req.user.id)) });
});

router.post('/', auth, upload.single('media'), (req, res) => {
  const caption = (req.body.caption || '').slice(0, 300);
  if (!caption && !req.file) return res.status(400).json({ error: 'Add a caption or media' });
  const id = nanoid();
  const isVideo = req.file ? /^video\//.test(req.file.mimetype) : false;
  const mediaUrl = req.file ? publicUrlFor(req, req.file.filename) : null;
  db.prepare('INSERT INTO videos (id, user_id, caption, media_url, is_video) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, caption, mediaUrl, isVideo ? 1 : 0);
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  res.status(201).json({ video: serialize(row, req.user.id) });
});

router.post('/:id/like', auth, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  const existing = db.prepare('SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?').get(video.id, req.user.id);
  if (existing) db.prepare('DELETE FROM video_likes WHERE video_id = ? AND user_id = ?').run(video.id, req.user.id);
  else db.prepare('INSERT INTO video_likes (video_id, user_id) VALUES (?, ?)').run(video.id, req.user.id);
  res.json({ video: serialize(video, req.user.id) });
});

module.exports = router;
