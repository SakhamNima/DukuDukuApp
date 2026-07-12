const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'dukuduku_session';

function signSession(user) {
  return jwt.sign({ uid: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Reads the session cookie OR an `Authorization: Bearer <token>` header
// (handy for non-browser clients / testing with curl).
function readToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function requireAuth(db) {
  return (req, res, next) => {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.uid);
      if (!user) return res.status(401).json({ error: 'Session user no longer exists' });
      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

function requireOwner(req, res, next) {
  if (!req.user || !req.user.is_owner) {
    return res.status(403).json({ error: 'Owner-only action' });
  }
  next();
}

module.exports = { COOKIE_NAME, signSession, setSessionCookie, clearSessionCookie, readToken, requireAuth, requireOwner };
