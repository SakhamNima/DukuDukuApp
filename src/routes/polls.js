const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const auth = requireAuth(db);

function serialize(poll, userId) {
  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ?').all(poll.id);
  const myVote = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, userId);
  return {
    id: poll.id,
    question: poll.question,
    options: options.map((o) => ({ id: o.id, label: o.label, votes: o.votes })),
    myVoteOptionId: myVote ? myVote.option_id : null,
  };
}

router.get('/', auth, (req, res) => {
  const polls = db.prepare('SELECT * FROM polls ORDER BY created_at DESC LIMIT 20').all();
  res.json({ polls: polls.map((p) => serialize(p, req.user.id)) });
});

router.post('/', auth, (req, res) => {
  const question = (req.body.question || '').trim().slice(0, 200);
  const options = Array.isArray(req.body.options) ? req.body.options.filter(Boolean).slice(0, 6) : [];
  if (!question || options.length < 2) return res.status(400).json({ error: 'Question and at least 2 options required' });

  const id = nanoid();
  db.prepare('INSERT INTO polls (id, question, created_by) VALUES (?, ?, ?)').run(id, question, req.user.id);
  for (const label of options) {
    db.prepare('INSERT INTO poll_options (id, poll_id, label, votes) VALUES (?, ?, ?, 0)').run(nanoid(), id, String(label).slice(0, 80));
  }
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(id);
  res.status(201).json({ poll: serialize(poll, req.user.id) });
});

router.post('/:id/vote', auth, (req, res) => {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });
  const alreadyVoted = db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, req.user.id);
  if (alreadyVoted) return res.status(409).json({ error: 'You already voted on this poll' });
  const option = db.prepare('SELECT * FROM poll_options WHERE id = ? AND poll_id = ?').get(req.body.optionId, poll.id);
  if (!option) return res.status(400).json({ error: 'Invalid option' });

  db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)').run(poll.id, req.user.id, option.id);
  db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(option.id);

  res.json({ poll: serialize(poll, req.user.id) });
});

module.exports = router;
