require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('replace-this')) {
  console.warn('\n⚠️  JWT_SECRET is not set to a real value. Sessions are insecure. Copy .env.example to .env and set a real secret.\n');
}

const db = require('./db');
require('./db-seed')();

const { router: authRouter } = require('./routes/auth');
const postsRouter = require('./routes/posts');
const storiesRouter = require('./routes/stories');
const videosRouter = require('./routes/videos');
const { router: chatsRouter, attachIo: attachChatsIo } = require('./routes/chats');
const walletRouter = require('./routes/wallet');
const { router: notificationsRouter, attachIo: attachNotifIo } = require('./routes/notifications');
const centerButtonRouter = require('./routes/centerButton');
const pollsRouter = require('./routes/polls');
const profileRouter = require('./routes/profile');
const { router: moderationRouter } = require('./routes/moderation');
const { UPLOAD_DIR } = require('./upload');

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const corsOptions = {
  origin: allowedOrigins.length ? allowedOrigins : true, // reflect request origin if none configured (dev convenience)
  credentials: true,
};

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'dukuduku-chat-server' }));

app.use('/api/auth', authRouter);
app.use('/api/posts', postsRouter);
app.use('/api/stories', storiesRouter);
app.use('/api/videos', videosRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/center-button', centerButtonRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/moderation', moderationRouter);

// Centralised error handler (e.g. multer file-too-large, JSON parse errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const io = new Server(server, { cors: corsOptions });
require('./socket')(io);
attachChatsIo(io);
attachNotifIo(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`DukuDukuChat server listening on http://localhost:${PORT}`);
  console.log(`  Health check:      GET  /health`);
  console.log(`  Dev login enabled: ${process.env.ALLOW_DEV_LOGIN === 'true' ? 'YES (never do this in production)' : 'no'}`);
});

module.exports = { app, server, io, db };
