const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('./notifications');

const router = express.Router();
const auth = requireAuth(db);

let io = null;
function attachIo(ioInstance) { io = ioInstance; }

const BOT_REPLIES = [
  'Sounds good! 👍', 'Haha true 😄', "I'll check and get back to you.",
  'Nice — DukuDukuChat feels smooth today.', '👀 interesting...', "Let's catch up later this week.",
];

function isMember(chatId, userId) {
  return !!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
}

function serializeChat(chat, userId) {
  const lastMsg = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').get(chat.id);
  const member = db.prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, userId);
  const unread = member
    ? db.prepare('SELECT COUNT(*) c FROM messages WHERE chat_id = ? AND created_at > ? AND (sender_id IS NULL OR sender_id != ?)')
        .get(chat.id, member.last_read_at, userId).c
    : 0;
  return {
    id: chat.id, name: chat.name, type: chat.type, avatarBg: chat.avatar_color,
    secret: !!chat.secret, lastMessage: lastMsg ? lastMsg.text : null, unread,
    canPost: chat.type !== 'Channel' || chat.created_by === userId,
  };
}

// GET /api/chats — chats you belong to, plus all Channels (broadcast, readable by everyone)
router.get('/', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT c.* FROM chats c
    LEFT JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
    WHERE cm.user_id IS NOT NULL OR c.type = 'Channel'
    ORDER BY c.created_at DESC
  `).all(req.user.id);

  // Auto-subscribe the user (read-only) to any Channel they aren't a member of yet,
  // so unread counts work the same way for channels as for direct/group chats.
  for (const c of rows) {
    if (c.type === 'Channel' && !isMember(c.id, req.user.id)) {
      db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, last_read_at) VALUES (?, ?, datetime(\'now\', \'-1 day\'))').run(c.id, req.user.id);
    }
  }

  res.json({ chats: rows.map((c) => serializeChat(c, req.user.id)) });
});

// POST /api/chats — { name, type }  (Direct/Group are private to you + a simulated contact; Channel is a public broadcast you own)
router.post('/', auth, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 60);
  const type = ['Direct', 'Group', 'Channel'].includes(req.body.type) ? req.body.type : 'Direct';
  if (!name) return res.status(400).json({ error: 'Chat name required' });

  const colors = ['#6C4FF5', '#FF5C7A', '#2ECC71', '#F5A623', '#3AA0FF', '#9B59B6'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const id = nanoid();
  db.prepare('INSERT INTO chats (id, name, type, avatar_color, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, type, color, req.user.id);
  db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(id, req.user.id);

  const welcome = type === 'Channel' ? `📢 Welcome to ${name}` : 'Hi! 👋 (simulated contact — replies automatically)';
  db.prepare('INSERT INTO messages (id, chat_id, sender_id, kind, text) VALUES (?, ?, NULL, \'text\', ?)').run(nanoid(), id, welcome);

  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  res.status(201).json({ chat: serializeChat(chat, req.user.id) });
});

// POST /api/chats/:id/secret — toggle
router.post('/:id/secret', auth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || !isMember(chat.id, req.user.id)) return res.status(404).json({ error: 'Chat not found' });
  const newVal = chat.secret ? 0 : 1;
  db.prepare('UPDATE chats SET secret = ? WHERE id = ?').run(newVal, chat.id);
  const text = newVal ? '🔒 Secret chat enabled — messages are end-to-end encrypted (demo)' : '🔓 Secret chat disabled';
  const msgId = nanoid();
  db.prepare('INSERT INTO messages (id, chat_id, sender_id, kind, text) VALUES (?, ?, NULL, \'sys\', ?)').run(msgId, chat.id, text);
  const updated = db.prepare('SELECT * FROM chats WHERE id = ?').get(chat.id);
  res.json({ chat: serializeChat(updated, req.user.id) });
});

// GET /api/chats/:id/messages
router.get('/:id/messages', auth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (!isMember(chat.id, req.user.id)) {
    if (chat.type === 'Channel') db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(chat.id, req.user.id);
    else return res.status(403).json({ error: 'Not a member of this chat' });
  }
  db.prepare('UPDATE chat_members SET last_read_at = datetime(\'now\') WHERE chat_id = ? AND user_id = ?').run(chat.id, req.user.id);

  const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 200').all(chat.id);
  const messages = rows.map((m) => ({
    id: m.id,
    from: m.kind === 'sys' ? 'sys' : (m.sender_id === req.user.id ? 'out' : 'in'),
    text: m.text,
    createdAt: m.created_at,
  }));
  res.json({ chat: serializeChat(chat, req.user.id), messages });
});

// POST /api/chats/:id/messages — { text }
router.post('/:id/messages', auth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (!isMember(chat.id, req.user.id)) return res.status(403).json({ error: 'Not a member of this chat' });
  if (chat.type === 'Channel' && chat.created_by !== req.user.id) return res.status(403).json({ error: 'Only the channel owner can broadcast' });

  const text = (req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message text required' });

  const id = nanoid();
  db.prepare('INSERT INTO messages (id, chat_id, sender_id, kind, text) VALUES (?, ?, ?, \'text\', ?)').run(id, chat.id, req.user.id, text);
  db.prepare('UPDATE chat_members SET last_read_at = datetime(\'now\') WHERE chat_id = ? AND user_id = ?').run(chat.id, req.user.id);
  const saved = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

  if (io) io.to(`chat:${chat.id}`).emit('message', { chatId: chat.id, message: { id: saved.id, from: 'out', text: saved.text, senderId: req.user.id, createdAt: saved.created_at } });

  // Simulated auto-reply for Direct/Group chats (not Channels) — mirrors the
  // "everyone's a demo contact" behaviour from the front-end-only prototype,
  // now actually persisted and pushed over the socket.
  if (chat.type !== 'Channel') {
    setTimeout(() => {
      const replyText = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
      const replyId = nanoid();
      db.prepare('INSERT INTO messages (id, chat_id, sender_id, kind, text) VALUES (?, ?, NULL, \'text\', ?)').run(replyId, chat.id, replyText);
      if (io) io.to(`chat:${chat.id}`).emit('message', { chatId: chat.id, message: { id: replyId, from: 'in', text: replyText, senderId: null, createdAt: new Date().toISOString() } });
      notify(req.user.id, '💬', `New message in ${chat.name}`);
    }, 1200 + Math.random() * 900);
  }

  res.status(201).json({ message: { id: saved.id, from: 'out', text: saved.text, createdAt: saved.created_at } });
});

// POST /api/qr-connect — simulate discovering a nearby user and starting a chat with them
router.post('/qr-connect', auth, (req, res) => {
  const names = ['Choden', 'Ugyen', 'Jigme', 'Yeshi', 'Pelden'];
  const name = names[Math.floor(Math.random() * names.length)];
  const colors = ['#6C4FF5', '#FF5C7A', '#2ECC71', '#F5A623', '#3AA0FF'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const id = nanoid();
  db.prepare('INSERT INTO chats (id, name, type, avatar_color, created_by) VALUES (?, ?, \'Direct\', ?, ?)').run(id, name, color, req.user.id);
  db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(id, req.user.id);
  db.prepare('INSERT INTO messages (id, chat_id, sender_id, kind, text) VALUES (?, ?, NULL, \'text\', ?)')
    .run(nanoid(), id, 'Hey, connected via QR on DukuDukuChat 👋');
  notify(req.user.id, '🔳', `You connected with ${name} via QR`);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  res.status(201).json({ chat: serializeChat(chat, req.user.id), name });
});

module.exports = { router, attachIo };
