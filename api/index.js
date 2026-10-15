import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json());

// Native CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Google OAuth Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Cached connection for Serverless
const uri = process.env.MONGODB_URI;
let cachedClient = null;
let cachedDb = null;

async function getDatabase() {
  if (cachedDb) return cachedDb;

  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing.');
  }

  const client = new MongoClient(uri, {
    tls: true,
    serverSelectionTimeoutMS: 5000,
  });

  cachedClient = await client.connect();
  const dbName = process.env.DB_NAME || 'vocabulary_machine';
  cachedDb = cachedClient.db(dbName);
  console.log(`Connected to MongoDB Atlas: ${dbName}`);
  return cachedDb;
}

// Database injection middleware
app.use('/api', async (req, res, next) => {
  try {
    req.db = await getDatabase();
    next();
  } catch (error) {
    console.error('Database connection error:', error.message);
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// ==========================================
// ALL ORIGINAL API ROUTES
// ==========================================

// 1. Get all words
app.get('/api/words', async (req, res) => {
  try {
    const words = await req.db.collection('words').find({}).toArray();
    res.json(words);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Add a single word
app.post('/api/words', async (req, res) => {
  try {
    const result = await req.db.collection('words').insertOne(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Batch add words
app.post('/api/words/batch', async (req, res) => {
  try {
    const { words } = req.body;
    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Invalid words array' });
    }
    const result = await req.db.collection('words').insertMany(words);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Get words for a specific user
app.get('/api/words/user', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const words = await req.db.collection('words').find({ userId }).toArray();
    res.json(words);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Update word
app.put('/api/words/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData._id;

    const result = await req.db.collection('words').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Delete word
app.delete('/api/words/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await req.db.collection('words').deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Record quiz history
app.post('/api/history', async (req, res) => {
  try {
    const result = await req.db.collection('history').insertOne({
      ...req.body,
      date: new Date()
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Get quiz history
app.get('/api/history', async (req, res) => {
  try {
    const history = await req.db.collection('history').find({}).sort({ date: -1 }).toArray();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Search dictionary
app.get('/api/dictionary', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const results = await req.db.collection('dictionary').find({
      word: { $regex: new RegExp(`^${query}`, 'i') }
    }).limit(10).toArray();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Google Auth
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const user = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };

    await req.db.collection('users').updateOne(
      { googleId: user.googleId },
      { $set: user },
      { upsert: true }
    );

    res.json(user);
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// 11. Get Notes
app.get('/api/notes', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const notes = await req.db.collection('notes').find({ userId }).toArray();
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12. Save Note
app.post('/api/notes', async (req, res) => {
  try {
    const { userId, word, note } = req.body;
    if (!userId || !word) {
      return res.status(400).json({ error: 'User ID and Word are required' });
    }
    const result = await req.db.collection('notes').updateOne(
      { userId, word },
      { $set: { note, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Local development fallback
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

export default app;