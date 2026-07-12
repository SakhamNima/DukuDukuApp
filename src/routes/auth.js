const express = require('express');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const db = require('../db');
const { verifyPiToken } = require('../auth/verifyPi');
const { verifyGoogleToken } = require('../auth/verifyGoogle');
const { verifyAppleToken } = require('../auth/verifyApple');
const { signSession, setSessionCookie, clearSessionCookie, requireAuth } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

function slugHandle(base) {
  const clean = String(base || 'user').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 20) || 'user';
  let handle = clean;
  let n = 0;
  const exists = (h) => db.prepare('SELECT 1 FROM users WHERE handle = ?').get(h);
  while (exists(handle)) { n += 1; handle = `${clean}_${n}`; }
  return handle;
}

function findOrCreateUser({ provider, providerUid, name, handle }) {
  const existing = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_uid = ?').get(provider, providerUid);
  if (existing) return existing;

  const id = nanoid();
  const finalHandle = slugHandle(handle);
  db.prepare(`
    INSERT INTO users (id, provider, provider_uid, name, handle)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, provider, providerUid, name || finalHandle, finalHandle);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function issueSession(res, user) {
  const token = signSession(user);
  setSessionCookie(res, token);
  return token;
}

function publicUser(u) {
  return {
    id: u.id, provider: u.provider, name: u.name, handle: u.handle,
    avatarColor: u.avatar_color, piBalance: u.pi_balance,
    requirePasscode: !!u.require_passcode, isOwner: !!u.is_owner,
  };
}

// ---- Pi Network ----
router.post('/pi-verify', authLimiter, async (req, res) => {
  try {
    const { accessToken } = req.body;
    const piUser = await verifyPiToken(accessToken);
    const user = findOrCreateUser({ provider: 'pi', providerUid: piUser.providerUid, name: piUser.name, handle: piUser.handle });
    const token = issueSession(res, user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ---- Google ----
router.post('/google-verify', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;
    const gUser = await verifyGoogleToken(idToken);
    const user = findOrCreateUser({ provider: 'google', providerUid: gUser.providerUid, name: gUser.name, handle: gUser.handle });
    const token = issueSession(res, user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ---- Apple ----
router.post('/apple-verify', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;
    const aUser = await verifyAppleToken(idToken);
    const user = findOrCreateUser({ provider: 'apple', providerUid: aUser.providerUid, name: aUser.name, handle: aUser.handle });
    const token = issueSession(res, user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ---- Dev-only bypass (local testing without real OAuth credentials) ----
router.post('/dev-login', authLimiter, async (req, res) => {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return res.status(403).json({ error: 'Dev login is disabled on this server' });
  }
  const name = (req.body && req.body.name) || 'Demo User';
  const providerUid = `dev_${name.toLowerCase().replace(/\s+/g, '_')}`;
  const user = findOrCreateUser({ provider: 'dev', providerUid, name, handle: name });
  const token = issueSession(res, user);
  res.json({ ok: true, token, user: publicUser(user), warning: 'Signed in via dev-login bypass — disable ALLOW_DEV_LOGIN in production' });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth(db), (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, publicUser, findOrCreateUser };
