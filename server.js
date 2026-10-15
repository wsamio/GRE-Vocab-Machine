import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'gre_vocab_machine';
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env and configure MongoDB Atlas.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('Set SESSION_SECRET to a random string of at least 32 characters in .env.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db(DB_NAME);
const users = db.collection('users');
const words = db.collection('words');
const progress = db.collection('user_word_progress');
const games = db.collection('game_sessions');
await Promise.all([
  users.createIndex({ emailLower: 1 }, { unique: true }),
  users.createIndex({ usernameLower: 1 }, { unique: true, sparse: true }),
  progress.createIndex({ userId: 1, wordId: 1 }, { unique: true }),
  progress.createIndex({ userId: 1, status: 1 }),
  progress.createIndex({ userId: 1, updatedAt: -1 }),
  games.createIndex({ userId: 1, completedAt: -1 }),
  words.createIndex({ dayNumber: 1, order: 1 }),
  words.createIndex({ wordLower: 1 }, { unique: true })
]);

const appSessionStore = MongoStore.create({
  client,
  dbName: DB_NAME,
  collectionName: 'sessions',
  ttl: 14 * 24 * 60 * 60
});
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(session({
  name: 'gre_vocab.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: appSessionStore,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.max(1, Number(process.env.SESSION_MAX_AGE_DAYS || 14)) * 86400000
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const gameLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
const clean = (v, max=2000) => String(v ?? '').trim().slice(0, max);
const userPublic = u => ({ id: String(u._id), email: u.email, username: u.username || '', createdAt: u.createdAt });
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in to use this feature.', code: 'AUTH_REQUIRED' });
  next();
}
function currentUserId(req) {
  try { return new ObjectId(req.session.userId); } catch { return null; }
}
async function getWord(wordId) {
  return words.findOne({ wordId: clean(wordId, 240) });
}
async function ensureDictionary() {
  if (await words.estimatedDocumentCount() > 0) return;
  const csvPath = path.join(__dirname, 'dictionary.csv');
  const fs = await import('node:fs/promises');
  let csvText;
  try { csvText = await fs.readFile(csvPath, 'utf8'); }
  catch { console.warn('dictionary.csv not found; run npm run import:dictionary after adding it.'); return; }
  const rows = parse(csvText.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, relax_quotes: true, bom: true, trim: true });
  await importRows(rows);
}
function splitList(v) { return clean(v, 5000).split(',').map(x => x.trim()).filter(Boolean); }
async function importRows(rows) {
  const normalized = rows.map((r, i) => ({
    sourceRow: i + 2,
    dayNumber: Number(r.day_number) || 1,
    word: clean(r.word, 200),
    wordLower: clean(r.word, 200).toLocaleLowerCase('en-US'),
    partsOfSpeech: clean(r.parts_of_speech, 200),
    definition: clean(r.definition, 5000),
    synonyms: clean(r.synonyms, 3000),
    antonyms: clean(r.antonyms, 3000),
    example: clean(r.example, 5000),
    defaultNote: clean(r.notes, 5000),
    matchingSourceRows: splitList(r.matching_words).map(Number).filter(Number.isFinite),
    order: i
  })).filter(r => r.word);
  const bySourceRow = new Map(normalized.map(w => [w.sourceRow, w]));
  const byDataRow = new Map(normalized.map((w, i) => [i + 1, w]));
  const docs = normalized.map(w => {
    const matchingWordIds = [...new Set(w.matchingSourceRows.map(n => bySourceRow.get(n) || byDataRow.get(n)).filter(Boolean).map(x => `${x.dayNumber}:${x.wordLower}`))];
    return {
      wordId: `${w.dayNumber}:${w.wordLower}`,
      dayNumber: w.dayNumber, word: w.word, wordLower: w.wordLower,
      partsOfSpeech: w.partsOfSpeech, definition: w.definition,
      synonyms: w.synonyms, antonyms: w.antonyms, example: w.example,
      defaultNote: w.defaultNote, matchingWordIds,
      matchingSourceRows: w.matchingSourceRows,
      sourceRow: w.sourceRow, order: w.order
    };
  });
  // Replace only the shared dictionary; user-specific records are untouched.
  await words.deleteMany({});
  for (let i = 0; i < docs.length; i += 500) await words.insertMany(docs.slice(i, i + 500), { ordered: false });
  console.log(`Imported ${docs.length} dictionary words.`);
}
await ensureDictionary();

app.get('/api/health', async (_req, res) => {
  try { await db.command({ ping: 1 }); res.json({ ok: true, dictionaryCount: await words.countDocuments() }); }
  catch { res.status(503).json({ ok: false }); }
});
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await users.findOne({ _id: currentUserId(req) }, { projection: { passwordHash: 0 } });
  if (!user) { req.session.destroy(() => {}); return res.json({ user: null }); }
  res.json({ user: userPublic(user) });
});
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const username = clean(req.body.username, 32);
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (username && !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, dots, underscores, or hyphens).' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password must be 10–128 characters long.' });
  const now = new Date();
  try {
    const user = { email, emailLower: email, username: username || '', ...(username ? { usernameLower: username.toLowerCase() } : {}), passwordHash: await bcrypt.hash(password, 12), createdAt: now, updatedAt: now };
    const result = await users.insertOne(user);
    req.session.userId = String(result.insertedId);
    res.status(201).json({ user: userPublic({ ...user, _id: result.insertedId }) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'That email or username is already registered.' });
    console.error('Registration failed:', e.message); res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const identifier = clean(req.body.identifier, 254).toLowerCase();
  const password = String(req.body.password || '');
  const user = await users.findOne({ $or: [{ emailLower: identifier }, { usernameLower: identifier }] });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Incorrect email/username or password.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start your session.' });
    req.session.userId = String(user._id);
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Could not save your session.' });
      res.json({ user: userPublic(user) });
    });
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(err => {
  if (err) return res.status(500).json({ error: 'Could not sign out.' });
  res.clearCookie('gre_vocab.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true });
}));

app.get('/api/words', async (_req, res) => {
  const list = await words.find({}, { projection: { _id: 0, wordId: 1, dayNumber: 1, word: 1, partsOfSpeech: 1, definition: 1, synonyms: 1, antonyms: 1, example: 1, defaultNote: 1, order: 1 } }).sort({ order: 1 }).toArray();
  res.json({ words: list });
});
app.get('/api/progress', requireAuth, async (req, res) => {
  const docs = await progress.find({ userId: currentUserId(req) }).toArray();
  res.json({ progress: docs.map(d => ({ wordId: d.wordId, status: d.status || '', note: d.note || '', hideDefaultNote: Boolean(d.hideDefaultNote), updatedAt: d.updatedAt })) });
});
app.put('/api/progress/:wordId', requireAuth, async (req, res) => {
  const wordId = clean(req.params.wordId, 240);
  if (!await getWord(wordId)) return res.status(404).json({ error: 'Word not found.' });
  const status = req.body.status;
  if (status !== undefined && !['', 'red', 'green'].includes(status)) return res.status(400).json({ error: 'Invalid learning status.' });
  if (req.body.note !== undefined && String(req.body.note).length > 2000) return res.status(400).json({ error: 'Notes must be 2,000 characters or fewer.' });
  const set = { updatedAt: new Date() };
  if (status !== undefined) set.status = status;
  if (req.body.note !== undefined) set.note = String(req.body.note);
  if (req.body.hideDefaultNote !== undefined) set.hideDefaultNote = Boolean(req.body.hideDefaultNote);
  await progress.updateOne({ userId: currentUserId(req), wordId }, { $set: set, $setOnInsert: { userId: currentUserId(req), wordId, createdAt: new Date() } }, { upsert: true });
  const saved = await progress.findOne({ userId: currentUserId(req), wordId });
  res.json({ progress: { wordId: saved.wordId, status: saved.status || '', note: saved.note || '', hideDefaultNote: Boolean(saved.hideDefaultNote) } });
});
app.delete('/api/progress', requireAuth, async (req, res) => {
  if (req.body?.confirm !== 'RESET_MY_PROGRESS') return res.status(400).json({ error: 'Confirmation is required.' });
  await progress.updateMany({ userId: currentUserId(req) }, { $set: { status: '', updatedAt: new Date() } });
  res.json({ ok: true });
});
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const [totalWords, grouped, recentGames, bestGame, gameCount] = await Promise.all([
    words.countDocuments(),
    progress.aggregate([{ $match: { userId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
    games.find({ userId }, { projection: { _id: 0, score: 1, totalQuestions: 1, correct: 1, accuracy: 1, durationSeconds: 1, completedAt: 1 } }).sort({ completedAt: -1 }).limit(5).toArray(),
    games.find({ userId }).sort({ score: -1, completedAt: -1 }).limit(1).next(),
    games.countDocuments({ userId })
  ]);
  const counts = Object.fromEntries(grouped.map(g => [g._id || '', g.count]));
  res.json({ totalWords, review: counts.red || 0, learned: counts.green || 0, unmarked: Math.max(0, totalWords - (counts.red || 0) - (counts.green || 0)), gameCount, recentGames, bestGame: bestGame ? { score: bestGame.score, accuracy: bestGame.accuracy, completedAt: bestGame.completedAt } : null });
});
app.get('/api/review', requireAuth, async (req, res) => {
  const records = await progress.find({ userId: currentUserId(req), status: 'red' }).toArray();
  if (!records.length) return res.json({ words: [] });
  const ids = records.map(r => r.wordId);
  const list = await words.find({ wordId: { $in: ids } }, { projection: { _id: 0, wordId: 1, dayNumber: 1, word: 1, definition: 1, synonyms: 1, antonyms: 1, defaultNote: 1, order: 1 } }).sort({ order: 1 }).toArray();
  res.json({ words: list });
});
app.post('/api/game/start', requireAuth, gameLimiter, async (req, res) => {
  const requested = Math.min(20, Math.max(5, Number(req.body?.questionCount) || 10));
  const count = await words.countDocuments({ matchingWordIds: { $exists: true, $ne: [] } });
  if (!count) return res.status(503).json({ error: 'No matching-word relationships are available. Check the dictionary import.' });
  const sample = await words.aggregate([{ $match: { matchingWordIds: { $exists: true, $ne: [] } } }, { $sample: { size: requested } }]).toArray();
  const questions = [];
  for (const word of sample) {
    const matches = await words.find({ wordId: { $in: word.matchingWordIds } }).toArray();
    if (!matches.length) continue;
    const correct = matches[Math.floor(Math.random() * matches.length)];
    const distractors = await words.aggregate([
      { $match: { wordId: { $nin: [word.wordId, ...word.matchingWordIds] }, dayNumber: { $exists: true } } },
      { $sample: { size: 12 } }
    ]).toArray();
    const options = [correct, ...distractors.slice(0, 3)].sort(() => Math.random() - 0.5);
    questions.push({ questionId: new ObjectId().toString(), wordId: word.wordId, word: word.word, options: options.map(o => ({ wordId: o.wordId, word: o.word })), answerWordId: correct.wordId });
  }
  if (!questions.length) return res.status(503).json({ error: 'Could not create questions from matching_words. Check row-number references in the CSV.' });
  const gameId = new ObjectId().toString();
  req.session.games = req.session.games || {};
  req.session.games[gameId] = { questions, startedAt: Date.now(), submittedAnswers: {} };
  res.json({ gameId, questions: questions.map(({ answerWordId, ...q }) => q) });
});
app.post('/api/game/answer', requireAuth, gameLimiter, async (req, res) => {
  const gameId = clean(req.body?.gameId, 64);
  const questionId = clean(req.body?.questionId, 64);
  const selectedWordId = clean(req.body?.wordId, 240);
  const game = req.session.games?.[gameId];
  const question = game?.questions?.find(q => q.questionId === questionId);
  if (!question) return res.status(400).json({ error: 'Question not found. Start a new game.' });
  const allowed = question.options.some(o => o.wordId === selectedWordId);
  if (!allowed) return res.status(400).json({ error: 'That option is not part of this question.' });
  const prior = game.submittedAnswers?.[questionId];
  if (prior) return res.json({ correct: prior.wordId === question.answerWordId, answerWord: prior.answerWord || '' });
  const correct = selectedWordId === question.answerWordId;
  const answerWord = await words.findOne({ wordId: question.answerWordId }, { projection: { _id: 0, word: 1 } });
  game.submittedAnswers[questionId] = { wordId: selectedWordId, answerWord: answerWord?.word || '', correct };
  req.session.games[gameId] = game;
  res.json({ correct, answerWord: answerWord?.word || '' });
});
app.post('/api/game/finish', requireAuth, gameLimiter, async (req, res) => {
  const gameId = clean(req.body?.gameId, 64);
  const sessionGame = req.session.games?.[gameId];
  if (!sessionGame) return res.status(400).json({ error: 'Game session not found. Start a new game.' });
  const details = sessionGame.questions.map(q => {
    const submitted = sessionGame.submittedAnswers?.[q.questionId];
    return { questionId: q.questionId, wordId: q.wordId, selectedWordId: submitted?.wordId || '', correct: Boolean(submitted && submitted.wordId === q.answerWordId) };
  });
  if (details.some(a => !a.selectedWordId)) return res.status(400).json({ error: 'Answer every question before finishing the game.' });
  const correct = details.filter(a => a.correct).length;
  const totalQuestions = sessionGame.questions.length;
  const score = correct * 100;
  const durationSeconds = Math.max(0, Math.round((Date.now() - sessionGame.startedAt) / 1000));
  const accuracy = Math.round(correct / totalQuestions * 100);
  const doc = { userId: currentUserId(req), gameId, score, correct, totalQuestions, accuracy, durationSeconds, completedAt: new Date(), answers: details };
  await games.insertOne(doc);
  delete req.session.games[gameId];
  res.json({ score, correct, totalQuestions, accuracy, durationSeconds });
});

app.use(express.static(__dirname, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});
// Export the Express app for Vercel's serverless function runtime.
export default app;

// Keep the normal Node.js server for local development and traditional hosting.
if (process.env.VERCEL !== '1') {
  const server = app.listen(PORT, () => console.log(`GRE Vocab Machine running at http://localhost:${PORT}`));
  async function shutdown() {
    server.close(async () => { await client.close(); process.exit(0); });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
