import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json());

// Built-in CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// MongoDB Connection Caching for Serverless
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
app.use(async (req, res, next) => {
  try {
    req.db = await getDatabase();
    next();
  } catch (error) {
    console.error('Database connection error:', error.message);
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// ==========================================
// API ROUTES
// ==========================================

// Get all words
app.get('/api/words', async (req, res) => {
  try {
    const words = await req.db.collection('words').find({}).toArray();
    res.json(words);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a word
app.post('/api/words', async (req, res) => {
  try {
    const result = await req.db.collection('words').insertOne(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update word
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

// Delete word
app.delete('/api/words/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await req.db.collection('words').deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Record quiz history
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

// Get quiz history
app.get('/api/history', async (req, res) => {
  try {
    const history = await req.db.collection('history').find({}).sort({ date: -1 }).toArray();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search dictionary
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

// Local development fallback
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

export default app;