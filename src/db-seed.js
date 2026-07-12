// Seeds a couple of starter rows so the app isn't empty on first boot.
// Safe to run every startup — uses INSERT OR IGNORE / existence checks.

const { nanoid } = require('nanoid');
const db = require('./db');

function seed() {
  const officialId = 'user_official';
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(officialId);
  if (!exists) {
    db.prepare(`
      INSERT INTO users (id, provider, provider_uid, name, handle, avatar_color, pi_balance, is_owner)
      VALUES (?, 'dev', 'official', 'DukuDuku Official', 'dukuduku_official', '#2ECC71', 1000, 1)
    `).run(officialId);

    db.prepare(`
      INSERT INTO posts (id, user_id, text, audience)
      VALUES (?, ?, 'Welcome to DukuDukuChat — this feed is backed by a real database now. Sign in and post something!', 'Public')
    `).run(nanoid(), officialId);

    const pollId = nanoid();
    db.prepare(`INSERT INTO polls (id, question, created_by) VALUES (?, 'Best feature so far?', ?)`).run(pollId, officialId);
    const opts = ['Customisable button', 'Unified chats', 'Short video Discover'];
    for (const label of opts) {
      db.prepare(`INSERT INTO poll_options (id, poll_id, label, votes) VALUES (?, ?, ?, 0)`).run(nanoid(), pollId, label);
    }
  }
}

module.exports = seed;
