const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const ai = require('../ai/engine');

const router = express.Router();
const auth = requireAuth(db);

// Lightweight per-user rate limiting so the AI endpoints can't be hammered
// (protects both a real upstream LLM bill and this server's CPU for the
// local heuristics). Simple in-memory sliding window — fine for a single
// server instance.
const hits = new Map();
function rateLimited(userId, max = 30, windowMs = 60000) {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(userId, arr);
  return arr.length > max;
}
function aiLimit(req, res, next) {
  if (rateLimited(req.user.id)) return res.status(429).json({ error: 'Too many AI requests — please slow down a little.' });
  next();
}

router.get('/status', auth, (req, res) => {
  res.json({ realProviderConfigured: ai.isRealProviderConfigured(), languages: ai.LANGUAGES });
});

router.post('/smart-replies', auth, aiLimit, async (req, res) => {
  try {
    const result = await ai.smartReplies((req.body.text || '').slice(0, 2000));
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Smart replies failed' }); }
});

router.post('/rewrite', auth, aiLimit, async (req, res) => {
  const text = (req.body.text || '').slice(0, 4000);
  if (!text.trim()) return res.status(400).json({ error: 'Text required' });
  try {
    const result = await ai.rewrite(text, req.body.tone);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Rewrite failed' }); }
});

router.post('/grammar', auth, aiLimit, async (req, res) => {
  const text = (req.body.text || '').slice(0, 4000);
  if (!text.trim()) return res.status(400).json({ error: 'Text required' });
  try {
    const result = await ai.grammarFix(text);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Grammar check failed' }); }
});

router.post('/translate', auth, aiLimit, async (req, res) => {
  const text = (req.body.text || '').slice(0, 4000);
  const target = (req.body.target || 'es').slice(0, 8);
  if (!text.trim()) return res.status(400).json({ error: 'Text required' });
  try {
    const result = await ai.translate(text, target);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Translation failed' }); }
});

// Summarizes an existing chat thread (pulls the last 60 messages from the DB
// so the client doesn't need to post the whole transcript).
router.post('/summarize', auth, aiLimit, async (req, res) => {
  const chatId = req.body.chatId;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });
  const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 60').all(chatId).reverse();
  const messages = rows.map((m) => ({ from: m.kind === 'sys' ? 'sys' : (m.sender_id === req.user.id ? 'out' : 'in'), text: m.text }));
  try {
    const result = await ai.summarize(messages);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Summarize failed' }); }
});

// AI chat assistant — stateless per request; the client keeps the short
// rolling history and sends it along so no separate DB table is needed.
router.post('/assistant', auth, aiLimit, async (req, res) => {
  const message = (req.body.message || '').slice(0, 2000);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];
  if (!message.trim()) return res.status(400).json({ error: 'Message required' });
  try {
    const result = await ai.chatAssistant(message, history);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Assistant failed' }); }
});

router.post('/captions', auth, aiLimit, async (req, res) => {
  try {
    const result = await ai.captions((req.body.text || '').slice(0, 2000));
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Caption generation failed' }); }
});

router.post('/emoji', auth, (req, res) => {
  res.json({ emojis: ai.emojiSuggest((req.body.text || '').slice(0, 2000)) });
});

router.post('/stickers', auth, aiLimit, async (req, res) => {
  try {
    const result = await ai.stickerSuggest((req.body.text || '').slice(0, 300));
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Sticker generation failed' }); }
});

module.exports = router;
