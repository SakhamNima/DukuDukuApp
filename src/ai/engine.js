// ============================================================================
// DukuDukuChat AI Engine
// ----------------------------------------------------------------------------
// A small, dependency-free "AI assistant" layer that powers every AI feature
// in the app: smart replies, rewriting, grammar fixes, translation,
// summarization, an in-app chat assistant, and caption/emoji/sticker
// suggestions.
//
// Design goal: the app must feel AI-powered *out of the box*, with zero setup
// and zero API keys, so every function below has a fast, deterministic,
// offline "heuristic" implementation. If a real LLM provider is configured
// via environment variables (OPENAI_API_KEY or ANTHROPIC_API_KEY, selected
// with AI_PROVIDER=openai|anthropic), that provider is tried first and the
// heuristic is used as an automatic fallback if the call fails, times out, or
// isn't configured. Every route always returns a usable result either way.
// ============================================================================

const AI_PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase(); // 'openai' | 'anthropic' | ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || '';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 8000;

function isRealProviderConfigured() {
  if (AI_PROVIDER === 'openai') return !!OPENAI_API_KEY;
  if (AI_PROVIDER === 'anthropic') return !!ANTHROPIC_API_KEY;
  return false;
}

// Calls the configured real LLM provider, if any. Returns the raw text
// response, or null if no provider is configured / the call failed for any
// reason (network, auth, timeout, malformed response, ...). Callers must
// always have a heuristic fallback ready — this function never throws.
async function callLLM(systemPrompt, userPrompt) {
  if (!isRealProviderConfigured() || typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    if (AI_PROVIDER === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: AI_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.6,
          max_tokens: 400,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    }
    if (AI_PROVIDER === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AI_MODEL || 'claude-3-5-haiku-20241022',
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.content?.[0]?.text?.trim() || null;
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ============================== helpers ============================== */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for',
  'and', 'or', 'but', 'so', 'it', 'its', 'this', 'that', 'i', 'you', 'we', 'they', 'he', 'she',
  'my', 'your', 'our', 'their', 'with', 'as', 'im', "i'm", 'me', 'do', 'does', 'did', 'not', 'no',
  'yes', 'just', 'really', 'very', 'like', 'about', 'have', 'has', 'had', 'will', 'can', 'could',
  'would', 'should', 'up', 'out', 'if', 'then', 'than', 'from', 'by', 'am',
]);

function keywords(text, max = 6) {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
  const freq = new Map();
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

function capitalizeSentences(text) {
  return text.replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase());
}

/* ============================== 1. SMART REPLIES ============================== */

const REPLY_BANK = {
  question: ["Good question — let me think and get back to you.", "Not 100% sure, but I'll find out!", "Great question 🤔"],
  greeting: ['Hey! 👋 How are you?', "Hi there! What's up?", 'Hello! Good to hear from you 😊'],
  thanks: ["You're welcome! 🙏", 'Anytime! 😊', 'No problem at all!'],
  time: ["Works for me — see you then!", "I'll check my schedule and confirm.", "Sounds good, I'll be there."],
  love: ['❤️ love that', 'Aww, that\'s so sweet 🥰', 'Same here! 💕'],
  bye: ['Take care! 👋', 'Talk soon!', 'Bye for now! 😊'],
  sorry: ["No worries at all!", "It's totally fine 😊", "Don't worry about it!"],
  congrats: ['Congratulations! 🎉', "That's amazing, so happy for you! 🥳", 'Well deserved! 👏'],
  default: ['Sounds good! 👍', 'Got it, thanks for letting me know.', 'Nice — tell me more?', 'Interesting! 😄', 'Got it 👍'],
};

function pickSmartReplies(lastText) {
  const t = (lastText || '').toLowerCase();
  let bucket = 'default';
  if (/\?\s*$/.test(t)) bucket = 'question';
  else if (/\b(hi|hey|hello|yo)\b/.test(t)) bucket = 'greeting';
  else if (/\b(thanks|thank you|thx|ty)\b/.test(t)) bucket = 'thanks';
  else if (/\b(tomorrow|today|tonight|later|meet|meeting|pm|am|o'clock|schedule)\b/.test(t)) bucket = 'time';
  else if (/\b(love|miss you|❤️|🥰|💕)\b/.test(t)) bucket = 'love';
  else if (/\b(bye|goodnight|see you|see ya|later gator)\b/.test(t)) bucket = 'bye';
  else if (/\b(sorry|apolog)\b/.test(t)) bucket = 'sorry';
  else if (/\b(congrats|congratulations|promoted|won|graduated|passed)\b/.test(t)) bucket = 'congrats';
  const pool = REPLY_BANK[bucket];
  return pool.slice(0, 3);
}

async function smartReplies(lastText) {
  const llm = await callLLM(
    'You suggest exactly 3 short chat replies (max 8 words each) to the message given by the user. Return them as a JSON array of 3 strings, nothing else.',
    lastText || ''
  );
  if (llm) {
    try {
      const parsed = JSON.parse(llm.match(/\[[\s\S]*\]/)?.[0] || llm);
      if (Array.isArray(parsed) && parsed.length) return { replies: parsed.slice(0, 3).map(String), source: 'ai' };
    } catch (e) { /* fall through to heuristic */ }
  }
  return { replies: pickSmartReplies(lastText), source: 'local' };
}

/* ============================== 2. REWRITE (tone) ============================== */

const CASUAL_TO_FORMAL = {
  gonna: 'going to', wanna: 'want to', gotta: 'have to', kinda: 'kind of', sorta: 'sort of',
  u: 'you', ur: 'your', r: 'are', pls: 'please', plz: 'please', thx: 'thank you', ty: 'thank you',
  asap: 'as soon as possible', btw: 'by the way', idk: "I don't know", imo: 'in my opinion',
  lol: '', lmao: '', omg: 'oh my goodness', yeah: 'yes', yep: 'yes', nah: 'no', dont: "don't",
  cant: "can't", im: "I'm",
};

function wordReplace(text, dict) {
  return text.replace(/\b[\w']+\b/g, (w) => {
    const lower = w.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(dict, lower)) {
      const repl = dict[lower];
      if (repl === '') return '';
      return w[0] === w[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl;
    }
    return w;
  }).replace(/\s{2,}/g, ' ').trim();
}

function rewriteProfessional(text) {
  let out = wordReplace(text, CASUAL_TO_FORMAL);
  out = out.replace(/!+/g, '.').replace(/\s*\.\.\.\s*/g, '. ');
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  out = capitalizeSentences(out);
  if (!/[.!?]$/.test(out)) out += '.';
  return out.length > 4 ? out : text;
}

function rewriteFriendly(text) {
  let out = capitalizeSentences(text.trim());
  if (!/[.!?]$/.test(out)) out += '!';
  const openers = ['Hey! ', 'Hi! ', ''];
  const opener = /^(hi|hey|hello)/i.test(out) ? '' : openers[Math.floor(Math.random() * 2)];
  const suffix = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out) ? '' : ' 😊';
  return (opener + out + suffix).trim();
}

const FILLER_PHRASES = [
  /\bi (just )?(wanted to|want to) (say|mention|let you know)( that)?\b/gi,
  /\bi think (that )?\b/gi, /\bi feel like\b/gi, /\bkind of\b/gi, /\bsort of\b/gi,
  /\bbasically\b/gi, /\bactually\b/gi, /\bjust\b/gi, /\breally\b/gi, /\bvery\b/gi,
  /\bin my opinion\b/gi, /\bto be honest\b/gi, /\bat the end of the day\b/gi,
];

function rewriteConcise(text) {
  let out = text;
  for (const re of FILLER_PHRASES) out = out.replace(re, '');
  out = out.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '); // keep first ~2 sentences
  out = out.replace(/\s{2,}/g, ' ').trim();
  out = capitalizeSentences(out);
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out.length > 2 ? out : text;
}

async function rewrite(text, tone) {
  const t = (tone || 'friendly').toLowerCase();
  const llm = await callLLM(
    `Rewrite the user's message in a ${t} tone. Keep it roughly the same length. Reply with ONLY the rewritten text, no quotes, no preamble.`,
    text || ''
  );
  if (llm) return { text: llm.replace(/^"|"$/g, ''), source: 'ai' };
  let out = text;
  if (t === 'professional') out = rewriteProfessional(text);
  else if (t === 'concise') out = rewriteConcise(text);
  else out = rewriteFriendly(text);
  return { text: out, source: 'local' };
}

/* ============================== 3. GRAMMAR FIX ============================== */

const SPELLING_FIXES = {
  teh: 'the', recieve: 'receive', definately: 'definitely', occured: 'occurred', seperate: 'separate',
  untill: 'until', wich: 'which', becuase: 'because', truely: 'truly', thier: 'their', freind: 'friend',
  wierd: 'weird', alot: 'a lot', cant: "can't", dont: "don't", wont: "won't", im: "I'm", ive: "I've",
  youre: "you're", theyre: "they're", isnt: "isn't", didnt: "didn't", couldnt: "couldn't",
  wouldnt: "wouldn't", shouldnt: "shouldn't", hasnt: "hasn't", havent: "haven't", whats: "what's",
  lets: "let's", thats: "that's", i: 'I',
};

function grammarFixLocal(text) {
  const changes = [];
  let out = text;
  out = wordReplace(out, SPELLING_FIXES);
  if (out !== text) changes.push('Fixed common spelling/contractions');
  out = out.replace(/\s{2,}/g, ' ');
  if (out !== text && !changes.length) changes.push('Removed extra spaces');
  out = out.replace(/\s+([,.!?])/g, '$1');
  out = capitalizeSentences(out.trim());
  if (out && !/[.!?"')\]]$/.test(out)) { out += '.'; changes.push('Added closing punctuation'); }
  if (out !== text && !changes.length) changes.push('Capitalized sentences');
  return { text: out, changes };
}

async function grammarFix(text) {
  const llm = await callLLM(
    'Fix the grammar and spelling of the user message. Reply with ONLY the corrected text, no quotes, no explanation.',
    text || ''
  );
  if (llm) return { text: llm.replace(/^"|"$/g, ''), changes: ['AI grammar & spelling pass'], source: 'ai' };
  const { text: out, changes } = grammarFixLocal(text || '');
  return { text: out, changes: changes.length ? changes : ['No issues found'], source: 'local' };
}

/* ============================== 4. TRANSLATE ============================== */

const LANGUAGES = {
  es: 'Spanish', fr: 'French', hi: 'Hindi', ne: 'Nepali', zh: 'Chinese', dz: 'Dzongkha', en: 'English',
};

// Small best-effort phrasebook used only when no real AI provider is
// configured. Real translation quality requires AI_PROVIDER to be set.
const PHRASEBOOK = {
  es: { hello: 'hola', hi: 'hola', 'thank you': 'gracias', thanks: 'gracias', yes: 'sí', no: 'no', please: 'por favor', 'good morning': 'buenos días', 'good night': 'buenas noches', bye: 'adiós', 'how are you': 'cómo estás', 'i love you': 'te quiero', ok: 'vale', friend: 'amigo', welcome: 'bienvenido' },
  fr: { hello: 'bonjour', hi: 'salut', 'thank you': 'merci', thanks: 'merci', yes: 'oui', no: 'non', please: "s'il vous plaît", 'good morning': 'bonjour', 'good night': 'bonne nuit', bye: 'au revoir', 'how are you': 'comment ça va', 'i love you': "je t'aime", ok: "d'accord", friend: 'ami', welcome: 'bienvenue' },
  hi: { hello: 'नमस्ते', hi: 'नमस्ते', 'thank you': 'धन्यवाद', thanks: 'धन्यवाद', yes: 'हाँ', no: 'नहीं', please: 'कृपया', 'good morning': 'सुप्रभात', 'good night': 'शुभ रात्रि', bye: 'अलविदा', 'how are you': 'आप कैसे हैं', 'i love you': 'मैं तुमसे प्यार करता हूँ', ok: 'ठीक है', friend: 'दोस्त', welcome: 'स्वागत' },
  ne: { hello: 'नमस्ते', hi: 'नमस्ते', 'thank you': 'धन्यवाद', thanks: 'धन्यवाद', yes: 'हो', no: 'होइन', please: 'कृपया', bye: 'फेरि भेटौंला', 'how are you': 'तपाईलाई कस्तो छ', ok: 'ठिक छ', friend: 'साथी', welcome: 'स्वागत छ' },
  zh: { hello: '你好', hi: '你好', 'thank you': '谢谢', thanks: '谢谢', yes: '是', no: '不', please: '请', 'good morning': '早上好', 'good night': '晚安', bye: '再见', 'how are you': '你好吗', 'i love you': '我爱你', ok: '好的', friend: '朋友', welcome: '欢迎' },
  dz: { hello: 'ཀུ་ཛུ་ཟང་པོ་', hi: 'ཀུ་ཛུ', 'thank you': 'ཐུགས་རྗེ་ཆེ', thanks: 'ཐུགས་རྗེ་ཆེ', yes: 'ཨིན', no: 'མེན', bye: 'ལོག་འོང་།', welcome: 'ཌུ་ཀུ་ཌུ་ཀུ་ལུ་བྱོན་པ་ལེགས་སོ' },
};

function translateLocal(text, target) {
  const dict = PHRASEBOOK[target];
  const langName = LANGUAGES[target] || target;
  if (!dict) return { text, note: `Demo translation isn't available for ${langName} yet — set AI_PROVIDER for full translation.` };
  const lower = text.trim().toLowerCase().replace(/[!.?]+$/, '');
  if (dict[lower]) return { text: dict[lower], note: `Demo phrasebook translation to ${langName}` };
  // word-by-word best effort for short phrases
  let matchedAny = false;
  const words = text.split(/\s+/).map((w) => {
    const clean = w.toLowerCase().replace(/[^a-z']/g, '');
    if (dict[clean]) { matchedAny = true; return dict[clean]; }
    return w;
  });
  if (matchedAny) return { text: words.join(' '), note: `Demo phrasebook translation to ${langName} (partial — configure AI_PROVIDER for full accuracy)` };
  return { text: `${text} [${langName}]`, note: `No real translation configured — set AI_PROVIDER + an API key for full ${langName} translation. Showing original text.` };
}

async function translate(text, target) {
  const langName = LANGUAGES[target] || target;
  const llm = await callLLM(
    `Translate the user's message to ${langName}. Reply with ONLY the translated text, nothing else.`,
    text || ''
  );
  if (llm) return { text: llm.replace(/^"|"$/g, ''), note: `Translated to ${langName}`, source: 'ai' };
  return { ...translateLocal(text || '', target), source: 'local' };
}

/* ============================== 5. SUMMARIZE ============================== */

function summarizeLocal(messages) {
  if (!messages || !messages.length) return 'There are no messages in this conversation yet.';
  const texts = messages.map((m) => m.text).filter(Boolean);
  const topics = keywords(texts.join(' '), 5);
  const first = messages[0];
  const last = messages[messages.length - 1];
  const span = messages.length;
  let out = `This conversation has ${span} message${span === 1 ? '' : 's'}.`;
  if (topics.length) out += ` Main topics: ${topics.join(', ')}.`;
  if (first?.text) out += ` It started with "${first.text.slice(0, 80)}${first.text.length > 80 ? '…' : ''}".`;
  if (last?.text && last !== first) out += ` Most recent message: "${last.text.slice(0, 80)}${last.text.length > 80 ? '…' : ''}".`;
  return out;
}

async function summarize(messages) {
  const transcript = (messages || []).map((m) => `${m.from === 'out' ? 'Me' : 'Them'}: ${m.text}`).join('\n').slice(0, 6000);
  const llm = await callLLM(
    'Summarize this chat conversation in 2-3 short sentences of plain prose (no bullet points, no markdown).',
    transcript
  );
  if (llm) return { summary: llm, source: 'ai' };
  return { summary: summarizeLocal(messages), source: 'local' };
}

/* ============================== 6. CHAT ASSISTANT ============================== */

const ASSISTANT_KB = [
  { k: /\bstor(y|ies)\b/, a: 'To add a Story, tap the "+" bubble at the start of the Stories row on your Feed, add a photo and caption, then share. It\'s visible to your chosen audience for 24 hours.' },
  { k: /\bsecret chats?\b|\bpasscode\b|\block\b/, a: 'You can turn any chat into a Secret Chat with the lock icon in the thread header. If "Require passcode" is on in your Profile settings, secret chats lock behind a 4-digit code (demo code: 1-2-3-4).' },
  { k: /\btips?\b|\bwallet\b|\bpi balance\b|π/, a: 'Open your Pi Wallet from the header chip or Profile → Pi Wallet & Tips. You can send a tip to any post or directly to a handle — it updates your balance and history in real time.' },
  { k: /\b(center|centre) button\b|\bcustomi[sz]e\b/, a: 'The owner account can customise what the centre "+" button in the bottom nav does — Profile → Customise centre button — pick an icon, colour, label and action.' },
  { k: /\bmini.?apps?\b|\bbots?\b|\bpolls?\b|\bsplit bill\b|\bqr\b/, a: 'Mini-Apps live under Profile → Mini-Apps & Bots: Polls, QR Connect (find nearby users), and Split Bill are ready to try, more are coming soon.' },
  { k: /\bdiscover\b|\bvideos?\b|\bshort video\b/, a: 'Discover is your short-video feed — tap "+ Create" there to post a video or photo, swipe up/down to browse, and double-tap-like style tap the heart to like.' },
  { k: /\btranslat\w*\b|\blanguages?\b/, a: 'Tap the 🌐 translate icon under any message, or set your preferred language in the thread\'s AI toolbar, to get an instant translation.' },
  { k: /\bsmart repl\w*\b|\bsuggest\w*\b/, a: 'When you receive a message, I\'ll suggest three quick replies above the input — tap one to send it instantly.' },
  { k: /\bvoice\b|\bspeak\b|\bmic(rophone)?\b/, a: 'Tap the 🎙️ mic icon in the message box to dictate a message with your voice, or tap 🔊 on any bubble to have it read aloud.' },
  { k: /\bstickers?\b|\bemojis?\b/, a: 'Tap the sticker icon next to the message box to generate AI stickers from a short description, or watch the emoji row for smart suggestions as you type.' },
  { k: /\bwho (made|built)\b|\bcreator\b|\bdeveloper\b/, a: "DukuDukuChat is an all-in-one social & chat app built on the Pi Network, combining a feed, stories, short videos, chats and a Pi wallet in one place." },
  { k: /\bhow are you\b/, a: "I'm doing great, thanks for asking! How can I help you today?" },
  { k: /\b(hi|hello|hey)\b/, a: "Hi! I'm Duku, your in-app AI assistant. Ask me how to use any feature, or just chat 🙂" },
  { k: /\bthanks?\b/, a: "You're welcome! Let me know if there's anything else I can help with." },
];

function assistantLocal(message) {
  const m = (message || '').toLowerCase();
  for (const entry of ASSISTANT_KB) if (entry.k.test(m)) return entry.a;
  const topic = keywords(message, 1)[0];
  if (topic) return `That's interesting! I don't have a specific tip about "${topic}" yet, but you can ask me about stories, secret chats, the Pi wallet, mini-apps, Discover videos, translation, or voice messages.`;
  return "I'm not sure I understood that — try asking me how to use a feature, like \"how do I send a tip\" or \"how do secret chats work\".";
}

async function chatAssistant(message, history) {
  const transcript = (history || []).slice(-6).map((m) => `${m.role === 'assistant' ? 'Duku' : 'User'}: ${m.text}`).join('\n');
  const llm = await callLLM(
    'You are Duku, a friendly, concise in-app AI assistant for the DukuDukuChat social app (feed, stories, chats, short videos, Pi wallet tipping, mini-apps). Answer helpfully in 1-3 short sentences.',
    (transcript ? transcript + '\n' : '') + 'User: ' + (message || '')
  );
  if (llm) return { reply: llm, source: 'ai' };
  return { reply: assistantLocal(message), source: 'local' };
}

/* ============================== 7. CAPTIONS ============================== */

const CAPTION_TEMPLATES = [
  (t, k) => `${t}${t ? ' — ' : ''}${k ? k + ' vibes ✨' : 'good vibes ✨'}`,
  (t, k) => `${k ? 'When ' + k + ' hits different 😄' : 'Just living my best life 😄'}${t ? ' — ' + t : ''}`,
  (t, k) => `${t || 'Moments worth sharing'} 🌟${k ? ' #' + k.replace(/\s+/g, '') : ''}`,
  (t, k) => `${t ? t + ' ' : ''}#DukuDuku${k ? ' #' + k.replace(/\s+/g, '') : ''} #goodtimes`,
];

function captionsLocal(text) {
  const k = keywords(text, 1)[0] || '';
  return CAPTION_TEMPLATES.map((fn) => fn((text || '').trim(), k)).map((s) => s.trim()).filter(Boolean).slice(0, 4);
}

async function captions(text) {
  const llm = await callLLM(
    'Suggest exactly 4 short, catchy social-media captions (with tasteful emoji/hashtags) based on the user\'s draft text or topic. Return a JSON array of 4 strings only.',
    text || 'a fun moment'
  );
  if (llm) {
    try {
      const parsed = JSON.parse(llm.match(/\[[\s\S]*\]/)?.[0] || llm);
      if (Array.isArray(parsed) && parsed.length) return { captions: parsed.slice(0, 4).map(String), source: 'ai' };
    } catch (e) { /* fall through */ }
  }
  return { captions: captionsLocal(text), source: 'local' };
}

/* ============================== 8. EMOJI SUGGESTIONS ============================== */

const EMOJI_MAP = [
  [/\b(love|miss you|heart)\b/, ['❤️', '🥰', '💕']],
  [/\b(happy|glad|great|awesome|yay)\b/, ['😄', '🎉', '✨']],
  [/\b(sad|down|upset|cry)\b/, ['😢', '💔', '🥺']],
  [/\b(funny|lol|haha|joke)\b/, ['😂', '🤣', '😆']],
  [/\b(food|eat|hungry|dinner|lunch)\b/, ['🍽️', '😋', '🍜']],
  [/\b(travel|trip|flight|vacation)\b/, ['✈️', '🌍', '🧳']],
  [/\b(money|pi|tip|pay|wallet)\b/, ['💰', '🥧', '💸']],
  [/\b(party|celebrate|birthday)\b/, ['🎉', '🥳', '🎂']],
  [/\b(work|office|meeting|deadline)\b/, ['💼', '📈', '🖥️']],
  [/\b(sleep|tired|night|bed)\b/, ['😴', '🌙', '🛌']],
  [/\b(sport|game|match|win)\b/, ['🏆', '⚽', '🔥']],
  [/\b(dog|cat|pet)\b/, ['🐶', '🐱', '🐾']],
  [/\b(rain|weather|sun|cold|hot)\b/, ['☀️', '🌧️', '❄️']],
  [/\b(thank|thanks)\b/, ['🙏', '😊', '💐']],
  [/\b(congrat|congratulations)\b/, ['🎉', '👏', '🏆']],
];

function emojiSuggest(text) {
  const t = (text || '').toLowerCase();
  for (const [re, emojis] of EMOJI_MAP) if (re.test(t)) return emojis;
  return ['👍', '😊', '🔥'];
}

/* ============================== 9. STICKERS ============================== */

const STICKER_LIBRARY = [
  { k: /\b(party|celebrate|birthday|congrat)\b/, emoji: '🎉', label: 'Party!', from: '#FF8C00', to: '#FFC107' },
  { k: /\b(love|heart|miss you)\b/, emoji: '❤️', label: 'Love it', from: '#FF6B6B', to: '#FFC107' },
  { k: /\b(laugh|lol|haha|funny)\b/, emoji: '😂', label: 'LOL', from: '#FFC107', to: '#FF8C00' },
  { k: /\b(fire|awesome|lit|amazing)\b/, emoji: '🔥', label: 'On fire', from: '#FF4E00', to: '#FFC107' },
  { k: /\b(thumbs up|good job|nice|great)\b/, emoji: '👍', label: 'Nice one', from: '#FF8C00', to: '#FFE082' },
  { k: /\b(wow|omg|amazed)\b/, emoji: '😮', label: 'Wow!', from: '#FFC107', to: '#FF8C00' },
  { k: /\b(sad|sorry|down)\b/, emoji: '🥺', label: 'Aw', from: '#FFB74D', to: '#FF8A65' },
  { k: /\b(sleepy|tired|night)\b/, emoji: '😴', label: 'Sleepy', from: '#FFD54F', to: '#FF8C00' },
  { k: /\b(coffee|tea|morning)\b/, emoji: '☕', label: 'Coffee time', from: '#FF8C00', to: '#FFCA28' },
  { k: /\b(thank|thanks)\b/, emoji: '🙏', label: 'Thank you', from: '#FFC107', to: '#FF8C00' },
];

function stickerSuggestLocal(text) {
  const t = (text || '').toLowerCase();
  const matches = STICKER_LIBRARY.filter((s) => s.k.test(t));
  const others = STICKER_LIBRARY.filter((s) => !matches.includes(s)).sort(() => Math.random() - 0.5);
  const picks = [...matches, ...others].slice(0, 6);
  return picks.map(({ emoji, label, from, to }) => ({ emoji, label, from, to }));
}

async function stickerSuggest(text) {
  return { stickers: stickerSuggestLocal(text), source: 'local' };
}

module.exports = {
  isRealProviderConfigured,
  smartReplies,
  rewrite,
  grammarFix,
  translate,
  summarize,
  chatAssistant,
  captions,
  emojiSuggest,
  stickerSuggest,
  LANGUAGES,
};
