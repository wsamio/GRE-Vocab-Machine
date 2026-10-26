(async () => {
  const root = document.querySelector('#test-content');
  const TIMER_KEY = 'vocabularyLearner.testTimer.v1';
  const req = async (url, options = {}) => {
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status, code: d.code });
    return d;
  };
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    kids.flat().forEach(c => c != null && e.append(c));
    return e;
  };
  const loader = msg => h('div', { class: 'cute-loader', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'cute-loader-card' }, h('span', { class: 'cute-loader-face cute-loader-front', text: 'V' }), h('span', { class: 'cute-loader-face cute-loader-back', text: 'Aa' })),
    h('div', { class: 'cute-loader-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('p', { class: 'cute-loader-text', text: msg }));
  const clock = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const secs = ms => (ms < 60000 ? (ms / 1000).toFixed(1) + 's' : clock(ms));
  const TYPE = { text_completion: 'Text completion', two_blank: 'Sentence equivalence' };
  const list = a => a.join(' and ');

  let me;
  try { me = await req('/api/me'); } catch (e) { root.replaceChildren(h('div', { class: 'feature-empty' }, h('h3', { text: 'Server unavailable' }), h('p', { text: e.message }))); return; }
  if (!me.user) return;

  let bounds = { minDay: 1, maxDay: 1 }, test = null;
  let timer = null; // { elapsed, startedAt, paused, tick }

  // ---------- timer (counts up, can be paused, survives leaving the page) ----------
  const saveTimer = () => { if (!timer || !test) return; try { localStorage.setItem(TIMER_KEY, JSON.stringify({ testId: test.testId, qid: timer.qid, elapsedMs: timerMs(), paused: timer.paused })); } catch {} };
  const timerMs = () => timer.elapsed + (timer.paused || timer.stopped ? 0 : performance.now() - timer.startedAt);
  function startTimer(qid, onTick) {
    stopTimer();
    let saved = null; try { saved = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch {}
    const resume = saved && saved.testId === test.testId && saved.qid === qid;
    timer = { qid, elapsed: resume ? Number(saved.elapsedMs) || 0 : 0, startedAt: performance.now(), paused: resume ? Boolean(saved.paused) : false, stopped: false, onTick };
    timer.tick = setInterval(() => { timer.onTick(); saveTimer(); }, 250);
    timer.onTick();
  }
  function pauseToggle() { if (!timer || timer.stopped) return; if (timer.paused) { timer.paused = false; timer.startedAt = performance.now(); } else { timer.elapsed = timerMs(); timer.paused = true; } timer.onTick(); saveTimer(); }
  function freezeTimer() { const ms = Math.round(timerMs()); timer.elapsed = ms; timer.stopped = true; clearInterval(timer.tick); return ms; }
  function stopTimer() { if (timer) clearInterval(timer.tick); timer = null; }
  window.addEventListener('pagehide', saveTimer);

  // ---------- screens ----------
  async function boot() {
    root.replaceChildren(loader('Getting your test ready…'));
    try { const d = await req('/api/test'); bounds = d.bounds; test = d.test; }
    catch (e) { root.replaceChildren(h('div', { class: 'feature-empty' }, h('h3', { text: 'Could not load the test' }), h('p', { text: e.message }), h('div', { class: 'feature-actions', style: 'justify-content:center' }, h('button', { onclick: boot, text: 'Try again' })))); return; }
    test ? resume() : renderStart();
  }

  function renderStart(error = '') {
    stopTimer();
    const from = h('input', { type: 'number', min: bounds.minDay, max: bounds.maxDay, value: bounds.minDay, inputmode: 'numeric' });
    const to = h('input', { type: 'number', min: bounds.minDay, max: bounds.maxDay, value: Math.min(bounds.maxDay, bounds.minDay + 4), inputmode: 'numeric' });
    const err = h('p', { class: 'form-error', role: 'alert', text: error });
    const go = h('button', { class: 'button-primary', type: 'button', text: 'Start test' });
    go.onclick = async () => {
      root.replaceChildren(loader('Preparing your questions…'));
      try { const d = await req('/api/test/start', { method: 'POST', body: JSON.stringify({ fromDay: Number(from.value), toDay: Number(to.value) }) }); bounds = d.bounds; test = d.test; try { localStorage.removeItem(TIMER_KEY); } catch {} resume(); }
      catch (e) { if (e.status === 409) return boot(); renderStart(e.message); }
    };
    root.replaceChildren(h('article', { class: 'feature-card' },
      h('h3', { style: 'margin-top:0', text: 'Set up your test' }),
      h('p', { class: 'feature-muted', text: `10 questions mixing text completion (one blank) and sentence equivalence (two blanks), drawn from the days you choose (${bounds.minDay}–${bounds.maxDay}). A timer counts up on each question and you can pause it. Words you miss are added to Review.` }),
      h('div', { class: 'range-form' }, h('label', {}, 'From day', from), h('label', {}, 'To day', to), go), err));
  }

  function resume() {
    const done = new Set(test.answers.map(a => a.qid));
    const idx = test.questions.findIndex(q => !done.has(q.qid));
    if (idx === -1) return renderAllAnswered();
    renderQuestion(idx);
  }

  function renderAllAnswered() {
    stopTimer();
    root.replaceChildren(h('article', { class: 'feature-card', style: 'text-align:center;padding:32px 18px' },
      h('h3', { style: 'margin-top:0', text: 'All questions answered' }), h('p', { class: 'feature-muted', text: 'Finish the test to see your report.' }),
      h('div', { class: 'feature-actions', style: 'justify-content:center' }, h('button', { class: 'button-primary', onclick: finish, text: 'See report' }))));
  }

  function sentenceNode(text) {
    const p = h('p', { class: 'test-sentence' });
    text.split(/_{3,}/).forEach((part, i, arr) => { p.append(part); if (i < arr.length - 1) p.append(h('span', { class: 'test-blank', 'aria-label': 'blank' })); });
    return p;
  }

  function renderQuestion(idx) {
    const q = test.questions[idx];
    const two = q.pick === 2;
    const chosen = [];
    let locked = false, nextBtn = null;

    const timerVal = h('span', { class: 'test-timer-value', text: '00:00' });
    const pauseBtn = h('button', { type: 'button', text: 'Pause', title: 'Pause or resume (P)', onclick: () => pauseToggle() });
    const card = h('article', { class: 'feature-card test-card' });
    const optsEl = h('div', { class: 'game-options test-options', role: two ? 'group' : 'radiogroup' });
    const feedback = h('div');
    const submit = h('button', { class: 'button-primary test-submit', type: 'button', text: 'Submit answer', disabled: '' });
    const actions = h('div', { class: 'feature-actions' });

    const buttons = q.options.map((o, i) => {
      const b = h('button', { class: 'game-option', type: 'button', 'data-opt': o }, h('kbd', { text: String(i + 1) }), o);
      b.onclick = () => choose(o, b);
      optsEl.append(b); return b;
    });

    function choose(o, b) {
      if (locked || timer.paused) return;
      if (!two) return answer([o]);
      const at = chosen.indexOf(o);
      if (at >= 0) { chosen.splice(at, 1); b.classList.remove('is-selected'); }
      else if (chosen.length < 2) { chosen.push(o); b.classList.add('is-selected'); }
      submit.disabled = chosen.length !== 2;
      b.setAttribute('aria-pressed', String(chosen.includes(o)));
    }

    async function answer(selected) {
      if (locked) return; locked = true;
      const timeMs = freezeTimer(); updateTimerUi();
      buttons.forEach(b => (b.disabled = true)); submit.disabled = true; pauseBtn.disabled = true;
      try {
        const r = await req('/api/test/answer', { method: 'POST', body: JSON.stringify({ qid: q.qid, selected, timeMs }) });
        test.answers.push({ qid: q.qid, selected, correct: r.correct, timeMs, correctAnswer: r.correctAnswer, word: r.word, definition: r.definition });
        buttons.forEach(b => { const o = b.dataset.opt; if (r.correctAnswer.some(c => c.toLowerCase() === o.toLowerCase())) b.classList.add('is-correct'); else if (selected.includes(o)) b.classList.add('is-wrong'); });
        const fb = h('div', { class: 'test-feedback ' + (r.correct ? 'is-right' : 'is-wrong'), role: 'status' },
          h('strong', { text: r.correct ? 'Correct!' : 'Not quite.' }),
          h('div', { text: (r.correct ? 'Answer: ' : 'Correct answer: ') + list(r.correctAnswer) + '.' }),
          r.definition ? h('div', { text: r.word + ' — ' + r.definition }) : null,
          !r.correct ? h('div', { class: 'feature-muted', text: 'Added to your Review list.' }) : null);
        feedback.replaceChildren(fb);
        const last = idx === test.questions.length - 1;
        nextBtn = h('button', { class: 'button-primary', type: 'button', text: last ? 'See report' : 'Next question', onclick: () => (last ? finish() : renderQuestion(idx + 1)) });
        actions.prepend(nextBtn); submit.remove(); nextBtn.focus();
      } catch (e) {
        if (e.code === 'NO_TEST') { test = null; return boot(); }
        locked = false; timer.stopped = false; timer.startedAt = performance.now(); timer.tick = setInterval(() => { timer.onTick(); saveTimer(); }, 250);
        buttons.forEach(b => (b.disabled = false)); pauseBtn.disabled = false; submit.disabled = two ? chosen.length !== 2 : true;
        feedback.replaceChildren(h('p', { class: 'form-error', role: 'alert', text: e.message }));
      }
    }
    submit.onclick = () => answer([...chosen]);

    function updateTimerUi() {
      timerVal.textContent = clock(timerMs());
      pauseBtn.textContent = timer.paused ? 'Resume' : 'Pause';
      card.classList.toggle('is-paused', timer.paused && !timer.stopped);
    }
    const endBtn = h('button', { type: 'button', text: 'End test', onclick: () => { if (confirm('End the test now? Questions you have not answered will be skipped.')) finish(); } });
    if (two) actions.append(submit);
    actions.append(endBtn);

    const answered = test.answers.length;
    card.append(
      h('div', { class: 'test-head' },
        h('div', {}, h('span', { class: 'feature-muted', text: `Question ${idx + 1} of ${test.questions.length}  ` }), h('span', { class: 'test-badge', text: TYPE[q.type] })),
        h('div', { class: 'test-timer' }, timerVal, pauseBtn)),
      h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(test.questions.length), 'aria-valuenow': String(answered) }, h('div', { class: 'progress-fill', style: `width:${answered / test.questions.length * 100}%` })),
      h('div', { class: 'test-body' },
        sentenceNode(q.sentence),
        h('p', { class: 'test-hint', text: two ? 'Select the two answers that fit the blank and give sentences with the same meaning.' : 'Select the word that best completes the sentence.' }),
        optsEl),
      h('p', { class: 'test-paused-note', text: 'Paused — press Resume when you are ready.' }),
      feedback, actions);
    root.replaceChildren(card);
    startTimer(q.qid, updateTimerUi);
  }

  async function finish() {
    stopTimer();
    root.replaceChildren(loader('Building your report…'));
    try { const d = await req('/api/test/finish', { method: 'POST', body: '{}' }); test = null; try { localStorage.removeItem(TIMER_KEY); } catch {} d.saved ? renderReport(d.report) : renderStart('That test had no answers, so nothing was saved.'); }
    catch (e) { if (e.code === 'NO_TEST') { test = null; return renderStart(); } root.replaceChildren(h('div', { class: 'feature-empty' }, h('h3', { text: 'Could not build the report' }), h('p', { text: e.message }), h('div', { class: 'feature-actions', style: 'justify-content:center' }, h('button', { onclick: finish, text: 'Try again' })))); }
  }

  function renderReport(r) {
    const stat = (label, value) => h('div', { class: 'stat-card' }, h('span', { text: label }), h('strong', { text: value }));
    const typeCard = k => { const s = r.byType[k]; return h('article', { class: 'feature-card' }, h('strong', { text: TYPE[k] }), h('p', { class: 'feature-muted', text: s.answered ? `${s.correct} of ${s.answered} correct · ${Math.round(s.correct / s.answered * 100)}% · avg ${secs(s.avgTimeMs)}` : 'No questions of this type.' })); };
    const rows = r.details.map(d => h('div', { class: 'report-row' },
      h('span', { class: 'report-mark ' + (d.skipped ? 'skip' : d.correct ? 'ok' : 'no'), text: d.skipped ? '–' : d.correct ? '✓' : '✗' }),
      h('div', {}, h('strong', { text: `${d.n}. ${d.word}` }), h('small', { text: TYPE[d.type] }),
        h('small', { text: d.skipped ? 'Skipped' : (d.correct ? 'You chose ' + list(d.selected) : 'You chose ' + list(d.selected) + ' · answer: ' + list(d.answer)) }),
        d.definition ? h('small', { text: d.definition }) : null),
      h('time', { text: d.skipped ? '' : secs(d.timeMs) })));
    root.replaceChildren(
      h('article', { class: 'feature-card', style: 'text-align:center;padding:28px 18px' },
        h('p', { class: 'feature-muted', text: `TEST COMPLETE · DAYS ${r.range.fromDay}–${r.range.toDay}` }),
        h('h2', { style: 'font-size:44px;margin:8px 0', text: `${r.correct} / ${r.answered}` }),
        h('p', { class: 'feature-muted', text: `${r.accuracy}% accuracy${r.skipped ? ` · ${r.skipped} skipped` : ''}` }),
        h('div', { class: 'feature-actions', style: 'justify-content:center' }, h('button', { class: 'button-primary', onclick: () => renderStart(), text: 'Take another test' }), h('a', { href: 'review.html', text: 'Open Review' }), h('a', { href: 'dashboard.html', text: 'Dashboard' }))),
      h('div', { class: 'report-grid' }, stat('Accuracy', r.accuracy + '%'), stat('Total time', clock(r.totalTimeMs)), stat('Avg per question', secs(r.avgTimeMs)), stat('Missed', String(r.answered - r.correct))),
      h('div', { class: 'report-split' }, typeCard('text_completion'), typeCard('two_blank')),
      r.fastest ? h('p', { class: 'feature-muted', text: `Fastest: ${r.fastest.word} (${secs(r.fastest.timeMs)}) · Slowest: ${r.slowest.word} (${secs(r.slowest.timeMs)})` }) :'',
      r.missed.length ? h('p', { class: 'feature-muted', text: `${r.missed.length} missed word${r.missed.length === 1 ? '' : 's'} added to Review: ${r.missed.map(m => m.word).join(', ')}` }) :h('p', { class: 'feature-muted', text: 'No missed words — nothing was added to Review.' }),
      h('article', { class: 'feature-card' }, h('h3', { style: 'margin-top:0', text: 'Question by question' }), ...rows));
  }

  document.addEventListener('keydown', e => {
    if (!test || !timer || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const key = e.key.toLowerCase();
    if (key === 'p') { e.preventDefault(); pauseToggle(); return; }
    const opts = [...root.querySelectorAll('.test-options .game-option')];
    if (/^[1-6]$/.test(e.key) && opts[Number(e.key) - 1] && !opts[Number(e.key) - 1].disabled) { e.preventDefault(); opts[Number(e.key) - 1].click(); }
    else if (e.key === 'Enter') { const go = root.querySelector('.feature-actions .button-primary:not(:disabled)'); if (go && document.activeElement !== go) { e.preventDefault(); go.click(); } }
  });

  boot();
})();