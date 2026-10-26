(async () => {
  const root = document.querySelector('#mem-content');
  const req = async (url, options = {}) => {
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
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

  let me;
  try { me = await req('/api/me'); } catch (e) { root.replaceChildren(h('div', { class: 'feature-empty' }, h('h3', { text: 'Server unavailable' }), h('p', { text: e.message }))); return; }
  if (!me.user) return;

  let bounds = { minDay: 1, maxDay: 1 }, data = null, filter = 'all', shown = 40, focusId = null;
  const open = new Set();
  let listEl = null, sentinel = null, observer = null;
  const STEP = 40;

  async function load() {
    root.replaceChildren(loader('Loading your words…'));
    try { const d = await req('/api/memorize'); bounds = d.bounds; data = d.session ? d : null; }
    catch (e) { root.replaceChildren(h('div', { class: 'feature-empty' }, h('h3', { text: 'Could not load this page' }), h('p', { text: e.message }), h('div', { class: 'feature-actions', style: 'justify-content:center' }, h('button', { onclick: load, text: 'Try again' })))); return; }
    data ? renderSession() : renderPicker();
  }

  function renderPicker(error = '') {
    const from = h('input', { type: 'number', min: bounds.minDay, max: bounds.maxDay, value: bounds.minDay, id: 'from-day', inputmode: 'numeric' });
    const to = h('input', { type: 'number', min: bounds.minDay, max: bounds.maxDay, value: Math.min(bounds.maxDay, bounds.minDay + 4), id: 'to-day', inputmode: 'numeric' });
    const err = h('p', { class: 'form-error', role: 'alert', text: error });
    const go = h('button', { class: 'button-primary', type: 'button', text: 'Shuffle my words' });
    go.onclick = async () => {
      err.textContent = ''; go.disabled = true;
      root.replaceChildren(loader('Shuffling your words…'));
      try { const d = await req('/api/memorize', { method: 'POST', body: JSON.stringify({ fromDay: Number(from.value), toDay: Number(to.value) }) }); bounds = d.bounds; data = d; filter = 'all'; shown = STEP; focusId = null; open.clear(); renderSession(); }
      catch (e) { renderPicker(e.message); }
    };
    root.replaceChildren(h('article', { class: 'feature-card' },
      h('h3', { style: 'margin-top:0', text: 'Choose your range' }),
      h('p', { class: 'feature-muted', text: `Pick the first and last day (${bounds.minDay}–${bounds.maxDay}). Every word in those days is shuffled together and the order is kept until you reset the range.` }),
      h('div', { class: 'range-form' }, h('label', {}, 'From day', from), h('label', {}, 'To day', to), go), err));
  }

  const counts = () => { const c = { green: 0, red: 0, none: 0 }; data.words.forEach(w => c[w.status === 'green' ? 'green' : w.status === 'red' ? 'red' : 'none']++); return c; };
  const visibleWords = () => data.words.filter(w => filter === 'all' || (filter === 'green' && w.status === 'green') || (filter === 'red' && w.status === 'red') || (filter === 'none' && !w.status));
  let barEl, chipEls = {}, statEl;

  function renderSession() {
    const { session } = data;
    barEl = h('div', { class: 'mem-bar', role: 'img' }, h('span', { class: 'seg-learned' }), h('span', { class: 'seg-review' }));
    statEl = h('p', { class: 'feature-muted', style: 'margin:0' });
    chipEls = {};
    const chips = h('div', { class: 'mem-chips' });
    [['all', 'All'], ['none', 'Not marked'], ['red', 'In review'], ['green', 'Learned']].forEach(([k, label]) => {
      const b = h('button', { class: 'mem-chip', type: 'button', onclick: () => { filter = k; shown = STEP; renderChips(); renderList(); } });
      chipEls[k] = { b, label }; chips.append(b);
    });
    const reset = h('button', { type: 'button', text: 'Reset range', onclick: async () => {
      if (!confirm('Reset your range? Your shuffled order will be cleared so you can pick new days. Your marks are kept.')) return;
      try { await req('/api/memorize', { method: 'DELETE', body: '{}' }); data = null; renderPicker(); } catch (e) { alert(e.message); }
    } });
    listEl = h('ol', { class: 'mem-list' });
    sentinel = h('div', { 'aria-hidden': 'true' });
    root.replaceChildren(
      h('article', { class: 'feature-card' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start' },
          h('div', {}, h('h3', { style: 'margin:0', text: session.fromDay === session.toDay ? `Day ${session.fromDay}` : `Days ${session.fromDay}–${session.toDay}` }), h('p', { class: 'feature-muted', style: 'margin:4px 0 0', text: `${data.words.length.toLocaleString()} words in shuffled order` })),
          h('div', { class: 'feature-actions', style: 'margin:0' }, reset)),
        barEl, statEl, chips,
        h('div', { class: 'mem-keys' }, ...[['↑ ↓', 'move'], ['Space', 'show meaning'], ['G', 'learned'], ['R', 'review'], ['W', 'clear'], ['S', 'speak']].map(([k, t]) => h('span', {}, h('kbd', { text: k }), ' ' + t)))),
      listEl, sentinel);
    renderChips(); renderList(); updateStats();
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(es => { if (es[0].isIntersecting && shown < visibleWords().length) { shown += STEP; renderList(); } }, { rootMargin: '400px' });
    observer.observe(sentinel);
  }

  function updateStats() {
    const c = counts(), n = data.words.length || 1;
    barEl.children[0].style.width = (c.green / n * 100) + '%';
    barEl.children[1].style.width = (c.red / n * 100) + '%';
    statEl.textContent = `${c.green} learned · ${c.red} in review · ${c.none} not marked`;
    barEl.setAttribute('aria-label', statEl.textContent);
    chipEls.all.b.textContent = `All (${n})`; chipEls.none.b.textContent = `Not marked (${c.none})`; chipEls.red.b.textContent = `In review (${c.red})`; chipEls.green.b.textContent = `Learned (${c.green})`;
  }
  function renderChips() { for (const [k, { b }] of Object.entries(chipEls)) b.classList.toggle('is-on', k === filter); }

  const field = (label, text) => text ? h('p', {}, h('span', { class: 'lbl', text: label }), text) : null;
  function buildItem(w, i) {
    const li = h('li', { class: 'mem-item', 'data-id': w.wordId, 'data-status': w.status || '' });
    const mark = (status, cls, label, tip) => h('button', { class: 'mem-mark ' + cls, type: 'button', title: tip, 'aria-pressed': String(w.status === status), onclick: e => { e.stopPropagation(); setStatus(w, w.status === status ? '' : status); } }, label);
    const row = h('div', { class: 'mem-row', onclick: () => { focusWord(w.wordId); toggleOpen(w.wordId); } },
      h('span', { class: 'mem-num', text: String(i + 1) }),
      h('div', { class: 'mem-main' }, h('div', { class: 'mem-word' }, w.word, w.partsOfSpeech ? h('span', { class: 'mem-pos', text: w.partsOfSpeech }) : null), h('div', { class: 'mem-day', text: 'Day ' + w.dayNumber })),
      h('div', { class: 'mem-marks' }, mark('red', 'm-red', 'Review', 'Mark for review (R)'), mark('green', 'm-green', 'Learned', 'Mark as learned (G)')));
    const note = w.note || (!w.hideDefaultNote ? w.defaultNote : '');
    const body = h('div', { class: 'mem-body' }, field('Meaning', w.definition), field('Synonyms', w.synonyms), field('Antonyms', w.antonyms), w.example ? h('p', {}, h('span', { class: 'lbl', text: 'Example' }), h('em', { text: w.example })) : null, field('Note', note));
    li.append(row, body);
    li.classList.toggle('is-open', open.has(w.wordId)); li.classList.toggle('is-focused', focusId === w.wordId);
    return li;
  }
  function renderList() {
    const list = visibleWords();
    listEl.replaceChildren();
    if (!list.length) { listEl.append(h('li', { class: 'feature-empty', text: 'No words in this view.' })); return; }
    list.slice(0, shown).forEach((w, i) => listEl.append(buildItem(w, data.words.indexOf(w))));
  }
  const itemFor = id => listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
  function focusWord(id, scroll = false) {
    if (focusId) itemFor(focusId)?.classList.remove('is-focused');
    focusId = id;
    const li = itemFor(id); if (li) { li.classList.add('is-focused'); if (scroll) li.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  function toggleOpen(id) { open.has(id) ? open.delete(id) : open.add(id); itemFor(id)?.classList.toggle('is-open', open.has(id)); }

  async function setStatus(w, status) {
    const prev = w.status; w.status = status;
    const li = itemFor(w.wordId);
    if (li) { const nw = buildItem(w, data.words.indexOf(w)); li.replaceWith(nw); }
    updateStats(); if (filter !== 'all') renderList();
    try { await req('/api/progress/' + encodeURIComponent(w.wordId), { method: 'PUT', body: JSON.stringify({ status }) }); }
    catch (e) { w.status = prev; updateStats(); renderList(); alert('Could not save that mark: ' + e.message); }
  }

  document.addEventListener('keydown', e => {
    if (!data || !listEl || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const list = visibleWords().slice(0, shown); if (!list.length) return;
    const idx = list.findIndex(w => w.wordId === focusId);
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(list.length - 1, Math.max(0, idx < 0 ? 0 : idx + (e.key === 'ArrowDown' ? 1 : -1))); focusWord(list[n].wordId, true); return; }
    const w = list[idx]; if (!w) return;
    if (e.code === 'Space') { e.preventDefault(); toggleOpen(w.wordId); }
    else if (key === 'g') { e.preventDefault(); setStatus(w, 'green'); }
    else if (key === 'r') { e.preventDefault(); setStatus(w, 'red'); }
    else if (key === 'w') { e.preventDefault(); setStatus(w, ''); }
    else if (key === 's' && 'speechSynthesis' in window) { e.preventDefault(); speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(w.word); u.lang = 'en-US'; speechSynthesis.speak(u); }
  });

  load();
})();
