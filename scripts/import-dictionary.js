import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { parse } from 'csv-parse/sync';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing. Configure .env first.');
const client = new MongoClient(process.env.MONGODB_URI);
const replace = process.argv.includes('--replace');
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'gre_vocab_machine');
  const collection = db.collection('words');
  await collection.createIndex({ wordId: 1 }, { unique: true });
  await collection.createIndex({ wordLower: 1 }, { unique: true });
  await collection.createIndex({ dayNumber: 1, order: 1 });
  if (!replace && await collection.countDocuments()) {
    console.log('Dictionary already has data. Nothing changed. Use --replace to explicitly refresh it.');
    process.exitCode = 0;
  } else {
    const csvText = await fs.readFile(path.join(__dirname, 'dictionary.csv'), 'utf8');
    const rows = parse(csvText.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, relax_quotes: true, bom: true, trim: true });
    const normalized = rows.map((r, i) => ({
      sourceRow: i + 2, dayNumber: Number(r.day_number) || 1,
      word: String(r.word || '').trim(), wordLower: String(r.word || '').trim().toLocaleLowerCase('en-US'),
      partsOfSpeech: String(r.parts_of_speech || '').trim(), definition: String(r.definition || '').trim(),
      synonyms: String(r.synonyms || '').trim(), antonyms: String(r.antonyms || '').trim(),
      example: String(r.example || '').trim(), defaultNote: String(r.notes || '').trim(),
      matchingSourceRows: String(r.matching_words || '').split(',').map(v => Number(v.trim())).filter(Number.isFinite),
      order: i
    })).filter(w => w.word);
    const bySourceRow = new Map(normalized.map(w => [w.sourceRow, w]));
    const byDataRow = new Map(normalized.map((w, i) => [i + 1, w]));
    const docs = normalized.map(w => {
      const matchingWordIds = [...new Set(w.matchingSourceRows.map(n => bySourceRow.get(n) || byDataRow.get(n)).filter(Boolean).map(x => `${x.dayNumber}:${x.wordLower}`))];
      return { wordId: `${w.dayNumber}:${w.wordLower}`, ...w, matchingWordIds };
    });
    if (replace) await collection.deleteMany({});
    for (let i = 0; i < docs.length; i += 500) await collection.insertMany(docs.slice(i, i + 500), { ordered: false });
    console.log(`Imported ${docs.length} words from dictionary.csv. User accounts, notes, and progress were not changed.`);
  }
} finally {
  await client.close();
}
