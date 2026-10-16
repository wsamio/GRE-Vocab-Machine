(() => {
  "use strict";

  const STORAGE = {
    state: "vocabularyLearner.state.v1",
    ui: "vocabularyLearner.ui.v1"
  };

  const state = {
    days: [],
    currentDayIndex: 0,
    currentWordIndex: 0,
    datasetKey: "",
    originalDays: [],
    dayOrders: {},
    cardStates: {},
    dictionary: {},
    isFlipped: false,
    secondaryView: "note",
    touchStartX: null,
    touchStartY: null,
    user: null,
    progressLoaded: false,
    progressTimers: {}
  };

  const el = {
    learningView: document.getElementById("learning-view"),
    datasetMeta: document.getElementById("dataset-meta"),
    daySelect: document.getElementById("day-select"),
    prevDay: document.getElementById("prev-day"),
    nextDay: document.getElementById("next-day"),
    cardStage: document.getElementById("card-stage"),
    card: document.getElementById("card"),
    wordFront: document.getElementById("word-front"),
    wordBack: document.getElementById("word-back"),
    statusBadge: document.getElementById("status-badge"),
    noteInput: document.getElementById("note-input"),
    noteStatus: document.getElementById("note-status"),
    notePanel: document.getElementById("note-panel"),
    dictionaryPanel: document.getElementById("dictionary-panel"),
    dictionaryWord: document.getElementById("dictionary-word"),
    dictionaryPos: document.getElementById("dictionary-pos"),
    dictionaryDefinition: document.getElementById("dictionary-definition"),
    dictionaryExamplePanel: document.getElementById("dictionary-example-panel"),
    dictionaryExample: document.getElementById("dictionary-example"),
    dictionarySynonyms: document.getElementById("dictionary-synonyms"),
    dictionaryAntonyms: document.getElementById("dictionary-antonyms"),
    speakButton: document.getElementById("speak-button"),
    wordPosition: document.getElementById("word-position"),
    dayProgress: document.getElementById("day-progress"),
    prevWord: document.getElementById("prev-word"),
    nextWord: document.getElementById("next-word"),
    wordDots: document.getElementById("word-dots"),
    toast: document.getElementById("toast"),
    helpButton: document.getElementById("help-button"),
    helpDialog: document.getElementById("help-dialog"),
    closeHelp: document.getElementById("close-help"),
    themeToggle: document.getElementById("theme-toggle"),
    shuffleDay: document.getElementById("shuffle-day"),
    themeColorMeta: document.getElementById("theme-color-meta"),
    defaultNoteWrap: document.getElementById("default-note-wrap"),
    defaultNoteText: document.getElementById("default-note-text"),
    hideDefaultNote: document.getElementById("hide-default-note"),
    accountButton: document.getElementById("account-button"),
    accountDialog: document.getElementById("account-dialog"),
    closeAccount: document.getElementById("close-account"),
    accountForm: document.getElementById("account-form"),
    accountTitle: document.getElementById("account-title"),
    accountIntro: document.querySelector(".account-intro"),
    accountIdentifier: document.getElementById("account-identifier"),
    accountUsername: document.getElementById("account-username"),
    usernameField: document.getElementById("username-field"),
    identifierLabel: document.getElementById("identifier-label"),
    accountPassword: document.getElementById("account-password"),
    accountError: document.getElementById("account-error"),
    accountSubmit: document.getElementById("account-submit"),
    accountModeToggle: document.getElementById("account-mode-toggle"),
    accountSwitchText: document.getElementById("account-switch-text"),
    signOutButton: document.getElementById("sign-out-button")
  };

  function safeGet(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  let accountMode = "login";
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Request failed.");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function wordId(dayId, word) {
    return `${dayId}:${String(word || "").toLocaleLowerCase("en-US")}`;
  }
  function currentWordId() {
    const day = state.days[state.currentDayIndex];
    return day ? wordId(day.id, currentWord()) : "";
  }
  function setAccountUI() {
    if (el.accountButton) el.accountButton.textContent = state.user ? (state.user.username || state.user.email) : "Sign in";
    if (el.noteInput) {
      el.noteInput.readOnly = !state.user;
      el.noteInput.placeholder = state.user
        ? "Add a meaning, mnemonic, example, or anything useful…"
        : "Sign in to add your own note…";
    }
    if (el.hideDefaultNote) el.hideDefaultNote.hidden = !state.user;
    if (el.noteStatus && !state.user) el.noteStatus.textContent = "Sign in to save notes";
    if (el.signOutButton) el.signOutButton.hidden = !state.user;
    if (el.hideDefaultNote) el.hideDefaultNote.textContent = "Delete";
  }
  function openAccount(mode = "login") {
    accountMode = mode;
    if (!el.accountDialog) {
      location.href = `index.html?auth=${mode}`;
      return;
    }
    const register = accountMode === "register";
    const profile = accountMode === "profile";
    el.accountTitle.textContent = profile ? "Your account" : register ? "Create account" : "Sign in";
    if (el.accountIntro) el.accountIntro.textContent = profile
      ? `Signed in as ${state.user?.email || "your account"}. Your notes and learning progress are saved privately.`
      : "Create an account to save notes, track learning progress, and play the vocabulary game.";
    el.accountForm.hidden = profile;
    el.accountSwitchText.parentElement.hidden = profile;
    if (profile) {
      el.accountError.hidden = true;
      el.accountIdentifier.value = state.user?.email || "";
      el.accountPassword.value = "";
    }
    el.accountSubmit.textContent = register ? "Create account" : "Sign in";
    el.identifierLabel.textContent = register ? "Email address" : "Email or username";
    el.accountIdentifier.type = "text";
    el.accountIdentifier.autocomplete = register ? "email" : "username";
    el.accountUsername.parentElement.hidden = !register;
    el.usernameField.hidden = !register;
    el.accountSwitchText.textContent = register ? "Already have an account?" : "Don't have an account?";
    el.accountModeToggle.textContent = register ? "Sign in" : "Create account";
    el.accountError.hidden = true;
    el.accountPassword.autocomplete = register ? "new-password" : "current-password";
    if (!el.accountDialog.open) el.accountDialog.showModal();
  }
  async function refreshUser() {
    try {
      const data = await api("/api/me");
      state.user = data.user;
      setAccountUI();
      if (state.user) {
        state.cardStates = {};
        await loadServerProgress();
      } else {
        state.cardStates = {};
        saveState();
        render();
      }
      const params = new URLSearchParams(location.search);
      if (params.get("auth") && !state.user) openAccount(params.get("auth") === "register" ? "register" : "login");
    } catch {
      state.user = null;
      setAccountUI();
    }
  }
  async function loadServerProgress() {
    if (!state.user) return;
    try {
      const data = await api("/api/progress");
      data.progress.forEach(item => {
        const parts = item.wordId.split(":");
        const dayId = parts.shift();
        const word = parts.join(":");
        const dayIndex = state.originalDays.findIndex(d => String(d.id) === dayId);
        if (dayIndex < 0) return;
        const originalWord = state.originalDays[dayIndex].words.find(w => w.toLocaleLowerCase("en-US") === word);
        if (!originalWord) return;
        const key = cardKeyFor(dayId, originalWord);
        state.cardStates[key] = {
          ...(state.cardStates[key] || { status: "", note: "" }),
          status: item.status || "",
          note: item.note || "",
          hideDefaultNote: Boolean(item.hideDefaultNote)
        };
      });
      state.progressLoaded = true;
      saveState();
      render();
      renderDictionary();
      if (el.noteInput) el.noteInput.value = currentCardState().note || "";
    } catch (error) {
      if (error.status === 401) state.user = null;
    }
  }
  function persistCurrentProgress(debounce = false) {
    if (!state.user) return;
    const id = currentWordId();
    if (!id) return;
    const key = id;
    const card = { ...currentCardState() };
    if (state.progressTimers[key]) clearTimeout(state.progressTimers[key]);
    const send = async () => {
      delete state.progressTimers[key];
      try {
        await api(`/api/progress/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({
            status: card.status || "",
            note: card.note || "",
            hideDefaultNote: Boolean(card.hideDefaultNote)
          })
        });
        if (el.noteStatus && id === currentWordId()) el.noteStatus.textContent = "Saved to your account";
      } catch (error) {
        if (el.noteStatus && id === currentWordId()) el.noteStatus.textContent = error.status === 401 ? "Sign in to save notes" : "Could not sync — retry";
      }
    };
    if (debounce) state.progressTimers[key] = setTimeout(send, 450);
    else send();
  }

  function getTheme() {
    return document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";
  }

  function applyTheme(theme, persist = true) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;

    if (el.themeToggle) {
      const dark = nextTheme === "dark";
      el.themeToggle.setAttribute("aria-checked", String(dark));
      el.themeToggle.setAttribute(
        "aria-label",
        dark ? "Switch to light mode" : "Switch to dark mode"
      );
      el.themeToggle.title = dark
        ? "Switch to light mode"
        : "Switch to dark mode";
    }

    if (el.themeColorMeta) {
      el.themeColorMeta.setAttribute(
        "content",
        nextTheme === "dark" ? "#171818" : "#f1ece0"
      );
    }

    if (!persist) return;

    const ui = safeGet(STORAGE.ui, {});
    safeSet(STORAGE.ui, {
      ...(ui && typeof ui === "object" ? ui : {}),
      theme: nextTheme
    });
  }

  function toggleTheme() {
    const nextTheme = getTheme() === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    showToast(nextTheme === "dark" ? "Dark mode" : "Light mode");
  }

  function initCursorGlow() {
    if (window.matchMedia?.("(pointer: coarse)").matches) return;

    let raf = 0;
    let x = window.innerWidth * 0.5;
    let y = window.innerHeight * 0.2;

    const update = () => {
      document.documentElement.style.setProperty("--cursor-x", `${x}px`);
      document.documentElement.style.setProperty("--cursor-y", `${y}px`);
      document.body.classList.add("cursor-glow-visible");
      raf = 0;
    };

    window.addEventListener("pointermove", event => {
      x = event.clientX;
      y = event.clientY;
      if (!raf) raf = requestAnimationFrame(update);
    }, { passive: true });

    window.addEventListener("pointerleave", () => {
      document.body.classList.remove("cursor-glow-visible");
    });
  }

  function showToast(message) {
    if (!el.toast) return;

    el.toast.textContent = message;
    el.toast.classList.add("is-visible");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, 1800);
  }

  // CSV parser supporting:
  // - commas inside quoted cells
  // - escaped quotes
  // - CRLF and LF line endings
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];

      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += char;
        }

        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (char === "\r") {
        if (text[i + 1] !== "\n") {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = "";
        }
      } else {
        cell += char;
      }
    }

    if (cell !== "" || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  function cleanCell(value) {
    return String(value ?? "")
      .replace(/^\uFEFF/, "")
      .trim();
  }

  function normalizeCSV(rows) {
    if (!rows.length) {
      return [];
    }

    const headers = rows[0].map(cleanCell);

    const validColumns = headers
      .map((header, index) => ({
        header,
        index
      }))
      .filter(item => item.header !== "");

    return validColumns
      .map(({ header, index }) => {
        const words = rows
          .slice(1)
          .map(row => cleanCell(row[index]))
          .filter(Boolean);

        return {
          id: header,
          words
        };
      })
      .filter(day => day.words.length > 0);
  }

  function normalizeDictionary(rows) {
    if (!rows.length) {
      return {};
    }

    const headers = rows[0].map(cleanCell);
    const indexOf = name =>
      headers.findIndex(
        header => header.toLowerCase() === name
      );

    const dayIndex = indexOf("day_number");
    const wordIndex = indexOf("word");
    const posIndex = indexOf("parts_of_speech");
    const definitionIndex = indexOf("definition");
    const synonymsIndex = indexOf("synonyms");
    const antonymsIndex = indexOf("antonyms");
    const exampleIndex = indexOf("example");
    const notesIndex = indexOf("notes");

    if (
      dayIndex < 0 ||
      wordIndex < 0 ||
      posIndex < 0 ||
      definitionIndex < 0 ||
      synonymsIndex < 0 ||
      antonymsIndex < 0
    ) {
      return {};
    }

    const dictionary = {};

    rows.slice(1).forEach(row => {
      const day = cleanCell(row[dayIndex]);
      const word = cleanCell(row[wordIndex]);

      if (!day || !word) {
        return;
      }

      dictionary[`${day}:${word.toLowerCase()}`] = {
        word,
        partsOfSpeech: cleanCell(row[posIndex]),
        definition: cleanCell(row[definitionIndex]),
        example: exampleIndex >= 0
          ? cleanCell(row[exampleIndex])
          : "",
        synonyms: cleanCell(row[synonymsIndex]),
        antonyms: cleanCell(row[antonymsIndex]),
        notes: notesIndex >= 0 ? cleanCell(row[notesIndex]) : ""
      };
    });

    return dictionary;
  }

  function dictionaryEntry() {
    const day = state.days[state.currentDayIndex];
    const word = currentWord();

    return state.dictionary[
      `${day?.id ?? ""}:${word.toLowerCase()}`
    ] || null;
  }

  function setText(element, value, fallback = "—") {
    if (!element) return;
    element.textContent = value || fallback;
  }

  function renderDictionary() {
    const entry = dictionaryEntry();

    setText(el.dictionaryWord, entry?.word || currentWord());
    setText(el.dictionaryPos, entry?.partsOfSpeech || "");
    setText(el.dictionaryDefinition, entry?.definition || "Dictionary entry unavailable.");

    if (el.dictionaryExamplePanel && el.dictionaryExample) {
      const example = entry?.example || "";
      el.dictionaryExamplePanel.hidden = !example;
      setText(el.dictionaryExample, example, "");
    }

    setText(el.dictionarySynonyms, entry?.synonyms || "—");
    setText(el.dictionaryAntonyms, entry?.antonyms || "—");

    const cardState = currentCardState();
    if (el.defaultNoteWrap && el.defaultNoteText) {
      const note = entry?.notes || "";
      const visible = Boolean(note) && !cardState.hideDefaultNote;
      el.defaultNoteWrap.hidden = !visible;
      el.defaultNoteText.textContent = note;
    }
    if (el.noteInput) el.noteInput.value = cardState.note || "";
    setAccountUI();

    if (el.dictionaryPanel) {
      el.dictionaryPanel.hidden =
        state.secondaryView !== "dictionary";
    }

    if (el.notePanel) {
      el.notePanel.hidden =
        state.secondaryView === "dictionary";
    }
  }

  function speakCurrentWord() {
    if (!("speechSynthesis" in window)) {
      showToast("Pronunciation is not supported here");
      return;
    }

    const word = currentWord();

    if (!word) return;

    window.speechSynthesis.cancel();

    const utterance =
      new SpeechSynthesisUtterance(word);

    utterance.lang = "en-US";
    utterance.rate = 0.9;
    utterance.pitch = 1;

    const voices =
      window.speechSynthesis.getVoices();

    const usVoice =
      voices.find(
        voice => voice.lang?.toLowerCase() === "en-us"
      ) ||
      voices.find(
        voice => voice.lang?.toLowerCase().startsWith("en-us")
      );

    if (usVoice) {
      utterance.voice = usVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  function showDictionary() {
    state.secondaryView = "dictionary";
    state.isFlipped = true;

    render();
  }

  function showNote() {
    state.secondaryView = "note";
    state.isFlipped = true;

    render();
  }

  function simpleHash(text) {
    let hash = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  }

  function datasetKeyFor(days) {
    return simpleHash(JSON.stringify(days));
  }

  function wordIdentity(word) {
    return String(word ?? "").trim().toLowerCase();
  }

  function cardKeyFor(dayId, word, datasetKey = state.datasetKey) {
    return `${datasetKey}:${dayId}:${wordIdentity(word)}`;
  }

  function cardKey(dayIndex, wordIndex) {
    const day = state.days[dayIndex];

    return cardKeyFor(
      day?.id ?? "",
      day?.words?.[wordIndex] ?? ""
    );
  }

  function cloneDays(days) {
    return days.map(day => ({
      id: day.id,
      words: [...day.words]
    }));
  }

  function validOrder(order, wordCount) {
    return Array.isArray(order) &&
      order.length === wordCount &&
      order.every(index =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < wordCount
      ) &&
      new Set(order).size === wordCount;
  }

  function applyDayOrders(days, dayOrders) {
    return days.map(day => {
      const saved = dayOrders?.[day.id];

      if (!saved?.shuffled || !validOrder(saved.order, day.words.length)) {
        return {
          id: day.id,
          words: [...day.words]
        };
      }

      return {
        id: day.id,
        words: saved.order.map(index => day.words[index])
      };
    });
  }

  function migrateCardStates(days, storedStates, datasetKey) {
    if (!storedStates || typeof storedStates !== "object") {
      return {};
    }

    const migrated = { ...storedStates };

    days.forEach(day => {
      day.words.forEach((word, index) => {
        const legacyKey = `${datasetKey}:${day.id}:${index}`;
        const stableKey = cardKeyFor(day.id, word, datasetKey);

        if (
          Object.prototype.hasOwnProperty.call(migrated, legacyKey) &&
          !Object.prototype.hasOwnProperty.call(migrated, stableKey)
        ) {
          migrated[stableKey] = migrated[legacyKey];
        }

        if (legacyKey !== stableKey) {
          delete migrated[legacyKey];
        }
      });
    });

    return migrated;
  }

  function shuffleIndexes(length) {
    const indexes = Array.from({ length }, (_, index) => index);

    for (let index = indexes.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [indexes[index], indexes[randomIndex]] = [indexes[randomIndex], indexes[index]];
    }

    if (
      indexes.length > 1 &&
      indexes.every((value, index) => value === index)
    ) {
      [indexes[0], indexes[1]] = [indexes[1], indexes[0]];
    }

    return indexes;
  }

  function updateShuffleButton() {
    if (!el.shuffleDay) return;

    const day = state.originalDays[state.currentDayIndex];
    const saved = day ? state.dayOrders[day.id] : null;
    const shuffled =
      Boolean(saved?.shuffled && validOrder(saved.order, day?.words?.length ?? 0));

    el.shuffleDay.classList.toggle("is-active", shuffled);
    el.shuffleDay.setAttribute(
      "aria-pressed",
      String(shuffled)
    );
    el.shuffleDay.setAttribute(
      "aria-label",
      shuffled
        ? `Restore original order for Day ${day?.id ?? ""}`
        : `Shuffle words for Day ${day?.id ?? ""}`
    );
    el.shuffleDay.title =
      shuffled
        ? "Restore original CSV order"
        : "Shuffle this day's words";
    el.shuffleDay.textContent = shuffled ? "↶" : "↝";
  }

  function toggleDayOrder() {
    const originalDay = state.originalDays[state.currentDayIndex];

    if (!originalDay) return;

    const currentWord = state.days[state.currentDayIndex]?.words[state.currentWordIndex] ?? "";
    const existing = state.dayOrders[originalDay.id];
    const isShuffled =
      Boolean(existing?.shuffled && validOrder(existing.order, originalDay.words.length));

    if (isShuffled) {
      delete state.dayOrders[originalDay.id];
    } else {
      state.dayOrders[originalDay.id] = {
        shuffled: true,
        order: shuffleIndexes(originalDay.words.length)
      };
    }

    state.days = applyDayOrders(state.originalDays, state.dayOrders);

    const nextIndex =
      state.days[state.currentDayIndex].words.findIndex(
        word => word === currentWord
      );

    state.currentWordIndex = nextIndex >= 0 ? nextIndex : 0;
    state.isFlipped = false;
    state.secondaryView = "note";

    render();
    saveState();

    showToast(
      isShuffled
        ? `Day ${originalDay.id} restored to CSV order`
        : `Day ${originalDay.id} shuffled`
    );
  }

  function currentWord() {
    return (
      state.days[state.currentDayIndex]?.words[
      state.currentWordIndex
      ] ?? ""
    );
  }

  function currentCardState() {
    return (
      state.cardStates[
      cardKey(
        state.currentDayIndex,
        state.currentWordIndex
      )
      ] || {
        status: "",
        note: ""
      }
    );
  }

  function saveState() {
    safeSet(
      STORAGE.state,
      state.user ? {} : state.cardStates
    );

    const ui = safeGet(STORAGE.ui, {});
    safeSet(STORAGE.ui, {
      ...(ui && typeof ui === "object" ? ui : {}),
      datasetKey: state.datasetKey,
      dayIndex: state.currentDayIndex,
      wordIndex: state.currentWordIndex,
      dayOrders: state.dayOrders,
      theme: getTheme()
    });
  }

  function loadDataset(
    days,
    preferredDay = 0,
    preferredWord = 0,
    savedDayOrders = {}
  ) {
    state.originalDays = cloneDays(days);
    state.datasetKey =
      datasetKeyFor(state.originalDays);

    state.dayOrders =
      savedDayOrders &&
        typeof savedDayOrders === "object"
        ? savedDayOrders
        : {};

    state.days =
      applyDayOrders(
        state.originalDays,
        state.dayOrders
      );

    const storedStates =
      safeGet(STORAGE.state, {});

    state.cardStates =
      migrateCardStates(
        state.originalDays,
        storedStates,
        state.datasetKey
      );

    if (!days.length) {
      return;
    }

    state.currentDayIndex =
      Math.max(
        0,
        Math.min(
          preferredDay,
          days.length - 1
        )
      );

    const wordCount =
      days[state.currentDayIndex].words.length;

    state.currentWordIndex =
      Math.max(
        0,
        Math.min(
          preferredWord,
          wordCount - 1
        )
      );

    state.isFlipped = false;
    state.secondaryView = "note";

    renderDaySelect();
    render();
    saveState();
  }

  function renderDaySelect() {
    if (!el.daySelect) return;

    const fragment =
      document.createDocumentFragment();

    state.days.forEach((day, index) => {
      const option =
        document.createElement("option");

      option.value = String(index);
      option.textContent =
        `Day ${day.id}`;

      fragment.appendChild(option);
    });

    el.daySelect.replaceChildren(fragment);

    el.daySelect.value =
      String(state.currentDayIndex);

    updateShuffleButton();
  }

  function renderStatus() {
    const cardState =
      currentCardState();

    el.card.classList.toggle(
      "status-red",
      cardState.status === "red"
    );

    el.card.classList.toggle(
      "status-green",
      cardState.status === "green"
    );

    if (cardState.status === "red") {
      el.statusBadge.textContent =
        "review";
    } else if (
      cardState.status === "green"
    ) {
      el.statusBadge.textContent =
        "learned";
    } else {
      el.statusBadge.textContent = "";
    }

    el.noteInput.value =
      cardState.note || "";

    renderDictionary();
  }

  function renderDots() {
    const words =
      state.days[
        state.currentDayIndex
      ]?.words || [];

    const fragment =
      document.createDocumentFragment();

    words.forEach((_, index) => {
      const dot =
        document.createElement("button");

      dot.type = "button";
      dot.className = "word-dot";

      dot.setAttribute(
        "aria-label",
        `Go to word ${index + 1}`
      );

      dot.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          state.currentWordIndex =
            index;

          state.isFlipped = false;

          render();
          saveState();
        }
      );

      const status =
        state.cardStates[
          cardKey(
            state.currentDayIndex,
            index
          )
        ]?.status;

      if (status === "red") {
        dot.classList.add(
          "status-red"
        );
      }

      if (status === "green") {
        dot.classList.add(
          "status-green"
        );
      }

      if (
        index ===
        state.currentWordIndex
      ) {
        dot.classList.add(
          "is-current"
        );
      }

      fragment.appendChild(dot);
    });

    el.wordDots.replaceChildren(
      fragment
    );
  }

  function render() {
    const day =
      state.days[
      state.currentDayIndex
      ];

    if (!day) return;

    const words = day.words;

    el.learningView.hidden = false;

    el.datasetMeta.textContent =
      `${state.days.length} days · ${words.length} words today`;

    el.daySelect.value =
      String(state.currentDayIndex);

    el.wordFront.textContent =
      currentWord();

    el.wordBack.textContent =
      currentWord();

    el.wordPosition.textContent =
      `${state.currentWordIndex + 1} / ${words.length}`;

    const learned =
      words.reduce(
        (count, _, index) => {
          const status =
            state.cardStates[
              cardKey(
                state.currentDayIndex,
                index
              )
            ]?.status;

          return (
            count +
            (status === "green"
              ? 1
              : 0)
          );
        },
        0
      );

    el.dayProgress.textContent =
      `${learned} learned`;

    updateShuffleButton();

    el.prevDay.disabled =
      state.currentDayIndex === 0;

    el.nextDay.disabled =
      state.currentDayIndex ===
      state.days.length - 1;

    el.prevWord.disabled =
      state.currentWordIndex === 0;

    el.nextWord.disabled =
      state.currentWordIndex ===
      words.length - 1;

    el.card.classList.toggle(
      "is-flipped",
      state.isFlipped
    );

    el.card.setAttribute(
      "aria-label",
      state.secondaryView === "dictionary" && state.isFlipped
        ? "Dictionary card. Press D or Escape to return to the word."
        : state.isFlipped
          ? "Flashcard back with personal note. Press Space or Escape to return to the word."
          : "Vocabulary flashcard. Press Space to flip, D for dictionary."
    );

    renderStatus();
    renderDots();
    renderDictionary();
  }

  function setWord(index) {
    const wordCount =
      state.days[
        state.currentDayIndex
      ]?.words.length || 0;

    if (!wordCount) return;

    state.currentWordIndex =
      Math.max(
        0,
        Math.min(
          index,
          wordCount - 1
        )
      );

    state.isFlipped = false;
    state.secondaryView = "note";

    render();
    saveState();
  }

  function setDay(index) {
    if (!state.days.length) return;

    state.currentDayIndex =
      Math.max(
        0,
        Math.min(
          index,
          state.days.length - 1
        )
      );

    state.currentWordIndex = 0;
    state.isFlipped = false;
    state.secondaryView = "note";

    render();
    saveState();
  }

  function moveDay(delta) {
    setDay(
      state.currentDayIndex + delta
    );
  }

  function moveWord(delta) {
    const nextIndex =
      state.currentWordIndex + delta;

    const words =
      state.days[
        state.currentDayIndex
      ]?.words || [];

    if (
      nextIndex < 0 ||
      nextIndex >= words.length
    ) {
      return;
    }

    setWord(nextIndex);
  }

  function toggleFlip() {
    state.isFlipped =
      !state.isFlipped;

    el.card.classList.toggle(
      "is-flipped",
      state.isFlipped
    );
  }

  function setStatus(status) {
    if (!state.user) {
      openAccount("login");
      showToast("Sign in to save learning progress");
      return;
    }
    const key =
      cardKey(
        state.currentDayIndex,
        state.currentWordIndex
      );

    const previous =
      state.cardStates[key] || {
        status: "",
        note: ""
      };

    state.cardStates[key] = {
      ...previous,
      status
    };

    render();
    saveState();
    persistCurrentProgress(false);

    if (status === "red") {
      showToast(
        "Marked for review"
      );
    } else if (status === "green") {
      showToast(
        "Marked as learned"
      );
    } else {
      showToast(
        "Color reset"
      );
    }
  }

  function openNote() {
    state.secondaryView = "note";
    state.isFlipped = true;

    el.card.classList.add(
      "is-flipped"
    );

    requestAnimationFrame(() => {
      el.noteInput.focus({
        preventScroll: true
      });

      el.noteInput.setSelectionRange(
        el.noteInput.value.length,
        el.noteInput.value.length
      );
    });
  }

  function saveNote(value) {
    if (!state.user) {
      if (el.noteInput) el.noteInput.value = currentCardState().note || "";
      return;
    }
    const key =
      cardKey(
        state.currentDayIndex,
        state.currentWordIndex
      );

    const previous =
      state.cardStates[key] || {
        status: "",
        note: ""
      };

    state.cardStates[key] = {
      ...previous,
      note: value
    };

    if (el.noteStatus) {
      el.noteStatus.textContent =
        "Saving…";
    }

    saveState();
    persistCurrentProgress(true);
  }

  function handleKeydown(event) {
    const tag =
      document.activeElement?.tagName?.toLowerCase();

    const typing =
      tag === "textarea" ||
      tag === "input" ||
      tag === "select";

    const key =
      event.key.toLowerCase();

    if (typing) {
      if (
        event.key === "Escape"
      ) {
        document.activeElement.blur();

        state.isFlipped = false;

        render();
      }

      return;
    }

    if (
      event.key === "ArrowLeft"
    ) {
      event.preventDefault();
      moveWord(-1);

    } else if (
      event.key === "ArrowRight"
    ) {
      event.preventDefault();
      moveWord(1);

    } else if (key === "r") {
      event.preventDefault();
      setStatus("red");

    } else if (key === "g") {
      event.preventDefault();
      setStatus("green");

    } else if (key === "w") {
      event.preventDefault();
      setStatus("");

    } else if (key === "n") {
      event.preventDefault();
      openNote();

    } else if (key === "d") {
      event.preventDefault();

      if (
        state.isFlipped &&
        state.secondaryView === "dictionary"
      ) {
        state.isFlipped = false;
        state.secondaryView = "note";
        render();
      } else {
        showDictionary();
      }

    } else if (key === "s") {
      event.preventDefault();
      speakCurrentWord();

    } else if (
      event.code === "Space"
    ) {
      event.preventDefault();

      if (state.isFlipped) {
        state.isFlipped = false;
        render();
      } else {
        toggleFlip();
      }

    } else if (
      event.key === "Escape"
    ) {
      state.isFlipped = false;
      state.secondaryView = "note";
      render();
    }
  }

  function handleTouchStart(event) {
    const touch =
      event.changedTouches[0];

    state.touchStartX =
      touch.clientX;

    state.touchStartY =
      touch.clientY;
  }

  function handleTouchEnd(event) {
    if (
      state.touchStartX === null ||
      state.touchStartY === null
    ) {
      return;
    }

    const touch =
      event.changedTouches[0];

    const dx =
      touch.clientX -
      state.touchStartX;

    const dy =
      touch.clientY -
      state.touchStartY;

    state.touchStartX = null;
    state.touchStartY = null;

    if (
      Math.abs(dx) < 55 ||
      Math.abs(dx) <
      Math.abs(dy) * 1.25
    ) {
      return;
    }

    if (dx < 0) {
      moveWord(1);
    } else {
      moveWord(-1);
    }
  }

  async function loadVocabulary() {
    try {
      const [vocabularyResponse, dictionaryResponse] =
        await Promise.all([
          fetch(
            "vocabulary.csv",
            {
              cache: "no-store"
            }
          ),
          fetch(
            "dictionary.csv",
            {
              cache: "no-store"
            }
          )
        ]);

      if (!vocabularyResponse.ok) {
        return;
      }

      const vocabularyText =
        await vocabularyResponse.text();

      const vocabularyRows =
        parseCSV(vocabularyText);

      const days =
        normalizeCSV(vocabularyRows);

      if (!days.length) {
        return;
      }

      if (dictionaryResponse.ok) {
        const dictionaryText =
          await dictionaryResponse.text();

        state.dictionary =
          normalizeDictionary(
            parseCSV(dictionaryText)
          );
      }

      const ui =
        safeGet(STORAGE.ui, {});

      if (ui && (ui.theme === "dark" || ui.theme === "light")) {
        applyTheme(ui.theme, false);
      }

      const newDatasetKey =
        datasetKeyFor(days);

      const sameDataset =
        ui.datasetKey ===
        newDatasetKey;

      const savedDayOrders =
        sameDataset &&
        ui.dayOrders &&
        typeof ui.dayOrders === "object"
          ? ui.dayOrders
          : {};

      loadDataset(
        days,
        sameDataset
          ? Number(ui.dayIndex) || 0
          : 0,
        sameDataset
          ? Number(ui.wordIndex) || 0
          : 0,
        savedDayOrders
      );
    } catch {
      // Intentionally do nothing.
      // If vocabulary.csv is unavailable,
      // no vocabulary is displayed.
    }
  }

  function boot() {
    if (!el.card) return;

    applyTheme(getTheme(), false);
    initCursorGlow();

    if (el.themeToggle) {
      el.themeToggle.addEventListener("click", toggleTheme);
    }
    if (el.accountButton) el.accountButton.addEventListener("click", async () => {
      if (!state.user) {
        try { const data = await api("/api/me"); state.user = data.user; setAccountUI(); }
        catch {}
      }
      openAccount(state.user ? "profile" : "login");
    });
    if (el.closeAccount) el.closeAccount.addEventListener("click", () => el.accountDialog.close());
    if (el.accountModeToggle) el.accountModeToggle.addEventListener("click", () => openAccount(accountMode === "login" ? "register" : "login"));
    if (el.accountForm) el.accountForm.addEventListener("submit", async event => {
      event.preventDefault();
      el.accountError.hidden = true;
      el.accountSubmit.disabled = true;
      try {
        const register = accountMode === "register";
        const payload = register
          ? { email: el.accountIdentifier.value, username: el.accountUsername.value, password: el.accountPassword.value }
          : { identifier: el.accountIdentifier.value, password: el.accountPassword.value };
        const data = await api(register ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
        state.user = data.user;
        state.cardStates = {};
        setAccountUI();
        await loadServerProgress();
        el.accountDialog.close();
        showToast(register ? "Account created" : "Signed in");
      } catch (error) {
        el.accountError.textContent = error.message;
        el.accountError.hidden = false;
      } finally {
        el.accountSubmit.disabled = false;
      }
    });
    if (el.signOutButton) el.signOutButton.addEventListener("click", async () => {
      try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
      catch {}
      state.user = null;
      state.cardStates = {};
      state.progressLoaded = false;
      saveState();
      setAccountUI();
      el.accountDialog.close();
      showToast("Signed out");
      location.reload();
    });
    if (el.hideDefaultNote) el.hideDefaultNote.addEventListener("click", () => {
      if (!state.user) { openAccount("login"); return; }
      const key = cardKey(state.currentDayIndex, state.currentWordIndex);
      const previous = state.cardStates[key] || { status: "", note: "" };
      state.cardStates[key] = { ...previous, hideDefaultNote: true };
      renderDictionary();
      persistCurrentProgress(false);
      saveState();
      showToast("Default note hidden for your account");
    });

    el.daySelect.addEventListener(
      "change",
      () =>
        setDay(
          Number(
            el.daySelect.value
          )
        )
    );

    el.prevDay.addEventListener(
      "click",
      () => moveDay(-1)
    );

    el.nextDay.addEventListener(
      "click",
      () => moveDay(1)
    );

    if (el.shuffleDay) {
      el.shuffleDay.addEventListener(
        "click",
        toggleDayOrder
      );
    }

    el.prevWord.addEventListener(
      "click",
      () => moveWord(-1)
    );

    el.nextWord.addEventListener(
      "click",
      () => moveWord(1)
    );

    el.card.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          el.noteInput
        ) {
          return;
        }

        toggleFlip();
      }
    );

    el.card.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter"
        ) {
          event.preventDefault();
          toggleFlip();

        } else if (
          event.code === "Space"
        ) {
          event.preventDefault();
          event.stopPropagation();
          toggleFlip();
        }
      }
    );

    el.noteInput.addEventListener(
      "click",
      event =>
        event.stopPropagation()
    );

    el.noteInput.addEventListener(
      "keydown",
      event =>
        event.stopPropagation()
    );

    el.noteInput.addEventListener(
      "keyup",
      event =>
        event.stopPropagation()
    );

    el.noteInput.addEventListener(
      "input",
      event =>
        saveNote(
          event.target.value
        )
    );

    el.speakButton.addEventListener(
      "click",
      event => {
        event.stopPropagation();
        speakCurrentWord();
      }
    );

    el.cardStage.addEventListener(
      "touchstart",
      handleTouchStart,
      { passive: true }
    );

    el.cardStage.addEventListener(
      "touchend",
      handleTouchEnd,
      { passive: true }
    );

    document.addEventListener(
      "keydown",
      handleKeydown
    );

    el.helpButton.addEventListener(
      "click",
      () => {
        if (
          typeof el.helpDialog.showModal ===
          "function"
        ) {
          el.helpDialog.showModal();
        } else {
          el.helpDialog.setAttribute(
            "open",
            ""
          );
        }
      }
    );

    el.closeHelp.addEventListener(
      "click",
      () =>
        el.helpDialog.close()
    );

    el.helpDialog.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          el.helpDialog
        ) {
          el.helpDialog.close();
        }
      }
    );

    window.addEventListener(
      "beforeunload",
      saveState
    );

    // Load the fixed CSV automatically, then restore account-backed progress.
    loadVocabulary().then(() => refreshUser());
  }

  boot();
})();