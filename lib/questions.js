// Turns the text_completion / two_blanker CSV cells into clean, validated question documents.
// Anything that does not pass validation is dropped, so a broken cell can never break a test.
const BLANK = /_{3,}/;
const str = v => String(v ?? '').trim();
const norm = v => str(v).toLocaleLowerCase('en-US');
const uniq = list => [...new Map(list.map(str).filter(Boolean).map(o => [norm(o), o])).values()];
function parseJson(raw) {
  try { return JSON.parse(String(raw ?? '').replace(/^\uFEFF/, '')); } catch { return null; }
}

export function buildQuestionDoc(row, wordId, dayNumber) {
  let answer = str(row.word);
  let tc = null;
  let tb = null;

  const t = parseJson(row.text_completion);
  if (t && Array.isArray(t.sentences) && Array.isArray(t.options)) {
    if (str(t.word)) answer = str(t.word);
    const items = [];
    t.sentences.forEach((sentence, i) => {
      const distractors = uniq(Array.isArray(t.options[i]) ? t.options[i] : []).filter(o => norm(o) !== norm(answer));
      if (BLANK.test(str(sentence)) && distractors.length === 3) items.push({ sentence: str(sentence), distractors });
    });
    if (items.length) tc = items;
  }

  const p = parseJson(row.two_blanker);
  if (p && BLANK.test(str(p.sentence)) && Array.isArray(p.correct_pair) && p.correct_pair.length === 2 && Array.isArray(p.options)) {
    const options = uniq(p.options);
    const spell = x => options.find(o => norm(o) === norm(x));
    const pair = p.correct_pair.map(spell);
    if (options.length === 6 && pair.every(Boolean) && norm(pair[0]) !== norm(pair[1])) {
      tb = { sentence: str(p.sentence), correctPair: pair, options };
      if (!t && str(p.word)) answer = str(p.word);
    }
  }

  if (!tc && !tb) return null;
  return { wordId, dayNumber, word: answer, tc, tb, hasTc: Boolean(tc), hasTb: Boolean(tb) };
}
