const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const db = require('./db');
const { COOKIE_NAME } = require('./middleware/auth');

function extractToken(socket) {
  const authToken = socket.handshake.auth && socket.handshake.auth.token;
  if (authToken) return authToken;
  const raw = socket.handshake.headers.cookie;
  if (!raw) return null;
  const parsed = cookie.parse(raw);
  return parsed[COOKIE_NAME] || null;
}

function initSocket(io) {
  io.use((socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('Not signed in'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.uid);
      if (!user) return next(new Error('Session user no longer exists'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid session'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    // Client tells us which chat screen it currently has open so we can room-scope message events.
    socket.on('chat:join', (chatId) => {
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, socket.user.id);
      if (isMember) socket.join(`chat:${chatId}`);
    });
    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
    });
    socket.on('chat:typing', (chatId) => {
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId: socket.user.id });
    });
  });
}

module.exports = initSocket;
