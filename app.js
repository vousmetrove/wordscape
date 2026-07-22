const STORAGE_KEY = "wordscape-english-first-v1";
const DAY = 86_400_000;
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30, 60];

const defaultState = {
  settings: { goal: 20, banks: ["CET4", "CET6", "IELTS"], provider: "youdao" },
  records: {},
  stats: { answers: 0, correct: 0, streak: 0, lastStudy: null },
  customWords: [],
};

let state = loadState();
let words = [...window.WORD_DATA, ...state.customWords];
let session = [];
let sessionIndex = 0;
let sessionMode = "today";
let toastTimer;
let searchTimer;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...defaultState,
      ...saved,
      settings: { ...defaultState.settings, ...(saved.settings || {}) },
      stats: { ...defaultState.stats, ...(saved.stats || {}) },
      records: saved.records || {},
      customWords: saved.customWords || [],
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function activeWords() {
  return words.filter((word) => state.settings.banks.includes(word.bank));
}

function getRecord(id) {
  return state.records[id] || null;
}

function getDueWords(offset = 0) {
  const target = addDays(dateKey(), offset);
  return activeWords().filter((word) => {
    const record = getRecord(word.id);
    return record?.seen && record.nextReview <= target;
  });
}

function getPlan() {
  const goal = state.settings.goal;
  const dueAll = getDueWords();
  const due = dueAll.slice(0, goal);
  const remaining = Math.max(0, goal - due.length);
  const fresh = activeWords().filter((word) => !getRecord(word.id)?.seen).slice(0, remaining);
  return { due, fresh, queue: [...due, ...fresh], overflow: Math.max(0, dueAll.length - goal) };
}

function init() {
  renderDate();
  renderBanks();
  renderDashboard();
  renderReview();
  renderMistakes();
  renderProgress();
  syncSettingsForm();
  bindEvents();
}

function renderDate() {
  const now = new Date();
  $("#today-label").textContent = new Intl.DateTimeFormat("en", { weekday: "long" }).format(now);
  $("#date-label").textContent = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(now);
}

function renderDashboard() {
  const plan = getPlan();
  const reviewCount = plan.due.length;
  const newCount = plan.fresh.length;
  const total = plan.queue.length;
  const reviewPercent = total ? (reviewCount / total) * 100 : 0;

  $("#plan-total").textContent = total;
  $("#due-count").textContent = reviewCount;
  $("#new-count").textContent = newCount;
  $("#review-nav-count").textContent = getDueWords().length;
  $("#mistake-nav-count").textContent = Object.values(state.records).filter((record) => record.inMistake).length;
  $("#profile-goal").textContent = `${state.settings.goal} words a day`;
  $(".review-fill").style.width = `${reviewPercent}%`;
  $(".new-fill").style.width = `${100 - reviewPercent}%`;

  if (!reviewCount) {
    $("#mix-explanation").textContent = "No review is due yet, so today is all new words.";
  } else if (plan.overflow) {
    $("#mix-explanation").textContent = `${reviewCount} reviews fill today's goal. ${plan.overflow} more wait in the queue.`;
  } else {
    $("#mix-explanation").textContent = `${reviewCount} reviews come first; ${newCount} new words complete the goal.`;
  }

  $("#selected-banks").innerHTML = state.settings.banks.map((bank) => `<span class="bank-pill">${bank.replace("CET", "CET-")}</span>`).join("");
  $("#start-session").disabled = !total;
  $("#start-session").innerHTML = total ? `Begin today’s session <span>→</span>` : `Today is complete <span>✓</span>`;
}

function bankCard(bank, preview = false) {
  const info = window.WORD_BANKS[bank];
  const localCount = words.filter((word) => word.bank === bank).length;
  const active = state.settings.banks.includes(bank);
  return `
    <article class="bank-card" data-bank="${bank}" data-letter="${info.letter}">
      <div class="bank-card-top"><span class="bank-code">${bank.replace("CET", "CET-")}</span><input type="checkbox" data-bank-toggle="${bank}" ${active ? "checked" : ""} aria-label="Use ${bank} words" /></div>
      <h3>${info.title}</h3><p>${info.subtitle}</p>
      <footer><span>${info.total.toLocaleString()} target words</span><span>${localCount} enriched now</span>${preview ? "" : "<span>Import-ready</span>"}</footer>
    </article>`;
}

function renderBanks() {
  const bankKeys = Object.keys(window.WORD_BANKS);
  $("#bank-preview-cards").innerHTML = bankKeys.map((bank) => bankCard(bank, true)).join("");
  $("#full-bank-grid").innerHTML = bankKeys.map((bank) => bankCard(bank)).join("");
}

function renderReview() {
  const due = getDueWords();
  $("#review-empty").hidden = due.length > 0;
  $("#review-list-wrap").hidden = due.length === 0;
  $("#review-list").innerHTML = due.map((word) => {
    const record = getRecord(word.id);
    return `<div class="word-list-row"><strong>${word.word}</strong><span>Stage ${record.stage + 1}</span><small>${record.failures ? `${record.failures} missed` : "on track"}</small></div>`;
  }).join("");
}

function renderMistakes() {
  const mistakes = words.filter((word) => getRecord(word.id)?.inMistake);
  $("#mistake-empty").hidden = mistakes.length > 0;
  $("#mistake-grid").innerHTML = mistakes.map((word) => {
    const record = getRecord(word.id);
    return `<article class="mistake-card"><span>${word.bank.replace("CET", "CET-")} · ${record.failures} FAILED RECALLS</span><h3>${word.word}</h3><p>${word.definition}</p><button type="button" data-practice-word="${word.id}">Rebuild this scene →</button></article>`;
  }).join("");
}

function renderProgress() {
  const records = Object.values(state.records).filter((record) => record.seen);
  $("#stat-met").textContent = records.length;
  $("#stat-strong").textContent = records.filter((record) => record.stage >= 3).length;
  $("#stat-rate").textContent = state.stats.answers ? `${Math.round((state.stats.correct / state.stats.answers) * 100)}%` : "—";
  $("#stat-streak").textContent = `${state.stats.streak || 0}d`;

  const weekdays = [];
  for (let index = 0; index < 7; index += 1) {
    const day = new Date();
    day.setDate(day.getDate() + index);
    const key = dateKey(day);
    const count = activeWords().filter((word) => getRecord(word.id)?.nextReview === key).length;
    weekdays.push({ label: new Intl.DateTimeFormat("en", { weekday: "short" }).format(day), count });
  }
  const max = Math.max(1, ...weekdays.map((day) => day.count));
  $("#schedule-bars").innerHTML = weekdays.map((day) => `<div class="schedule-day"><b>${day.count || ""}</b><i style="height:${Math.max(4, (day.count / max) * 120)}px"></i><span>${day.label}</span></div>`).join("");
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.viewPanel === name));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "review") renderReview();
  if (name === "mistakes") renderMistakes();
  if (name === "progress") renderProgress();
}

function startSession(queue, mode = "today") {
  if (!queue.length) {
    showToast("Nothing is waiting right now");
    return;
  }
  session = queue;
  sessionIndex = 0;
  sessionMode = mode;
  $("#study-mode-label").textContent = mode === "review" ? "REVIEW QUEUE" : mode === "mistake" ? "MISTAKE BOOK" : "TODAY’S MIX";
  $("#study-total").textContent = session.length;
  $("#study-overlay").classList.add("open");
  $("#study-overlay").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderStudyWord();
}

function renderStudyWord() {
  const word = session[sessionIndex];
  const record = getRecord(word.id);
  $("#study-index").textContent = sessionIndex + 1;
  $("#study-progress-fill").style.width = `${(sessionIndex / session.length) * 100}%`;
  $("#study-bank").textContent = word.bank.replace("CET", "CET-");
  $("#study-status").textContent = record?.seen ? `REVIEW · STAGE ${record.stage + 1}` : "NEW";
  $("#study-word").textContent = word.word;
  $("#study-phonetic").textContent = word.phonetic || "pronunciation available online";
  $("#study-pos").textContent = word.pos || "word";
  $("#scene-emoji").textContent = word.emoji || "💭";
  $("#study-scene").textContent = word.scene || `Picture a clear moment where “${word.word}” is happening.`;
  $("#study-definition").textContent = word.definition;
  $("#study-example").textContent = word.example || `Use “${word.word}” in a scene you know well.`;
  $("#study-source").textContent = word.source || "Imported word bank";
  $("#study-source-link").hidden = !word.sourceUrl;
  $("#study-source-link").href = word.sourceUrl || "#";
  $("#chinese-result").hidden = true;
  $("#chinese-result").textContent = "";
  $("#reveal-chinese").disabled = false;
  $("#study-card").animate([{ opacity: .55, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 240 });
}

function answerWord(answer) {
  const word = session[sessionIndex];
  const today = dateKey();
  const record = state.records[word.id] || { seen: false, stage: 0, failures: 0, attempts: 0, correct: 0, inMistake: false };
  record.seen = true;
  record.attempts += 1;
  record.lastReviewed = today;
  state.stats.answers += 1;

  if (answer === "forgot") {
    record.failures += 1;
    record.stage = 0;
    record.nextReview = addDays(today, 1);
    if (record.failures >= 3) record.inMistake = true;
  } else if (answer === "hard") {
    record.stage = Math.max(0, record.stage - 1);
    record.nextReview = addDays(today, 1);
  } else {
    const interval = REVIEW_INTERVALS[Math.min(record.stage, REVIEW_INTERVALS.length - 1)];
    record.stage = Math.min(record.stage + 1, REVIEW_INTERVALS.length - 1);
    record.nextReview = addDays(today, interval);
    record.correct += 1;
    state.stats.correct += 1;
    if (record.inMistake && record.stage >= 3) record.inMistake = false;
  }

  state.records[word.id] = record;
  updateStreak(today);
  saveState();

  if (answer === "forgot" && record.failures === 3) showToast(`${word.word} moved to your mistake book`);
  sessionIndex += 1;
  if (sessionIndex >= session.length) finishSession();
  else renderStudyWord();
}

function updateStreak(today) {
  if (state.stats.lastStudy === today) return;
  const yesterday = addDays(today, -1);
  state.stats.streak = state.stats.lastStudy === yesterday ? state.stats.streak + 1 : 1;
  state.stats.lastStudy = today;
}

function finishSession() {
  closeStudy();
  renderDashboard();
  renderReview();
  renderMistakes();
  renderProgress();
  showToast("Session complete — the next review is scheduled");
}

function closeStudy() {
  $("#study-overlay").classList.remove("open");
  $("#study-overlay").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function speakCurrentWord() {
  const word = session[sessionIndex];
  if (!word || !("speechSynthesis" in window)) return showToast("Speech is not available in this browser");
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word.word);
  utterance.lang = "en-GB";
  utterance.rate = .82;
  speechSynthesis.speak(utterance);
}

async function revealChinese() {
  const word = session[sessionIndex];
  const result = $("#chinese-result");
  const button = $("#reveal-chinese");
  button.disabled = true;
  result.hidden = false;
  result.textContent = "Looking it up only because you asked…";
  const provider = state.settings.provider;

  if (provider === "local") {
    result.textContent = word.chinese || "No local Chinese hint is stored for this word.";
    return;
  }

  try {
    const response = await fetch(`/api/translate?word=${encodeURIComponent(word.word)}&provider=${provider}`);
    if (!response.ok) throw new Error("Translation provider is not configured");
    const data = await response.json();
    result.textContent = data.translation;
  } catch {
    result.textContent = word.chinese ? `${word.chinese} · local fallback` : "Connect the selected API in your deployment to reveal Chinese.";
  }
}

function syncSettingsForm() {
  $("#daily-goal").value = state.settings.goal;
  $("#goal-output").textContent = state.settings.goal;
  $("#translation-provider").value = state.settings.provider;
  $$("input[name='bank']").forEach((input) => { input.checked = state.settings.banks.includes(input.value); });
}

function openSettings() {
  syncSettingsForm();
  $("#settings-dialog").showModal();
}

function saveSettings(event) {
  event.preventDefault();
  const banks = $$("input[name='bank']:checked").map((input) => input.value);
  if (!banks.length) return showToast("Keep at least one word bank active");
  state.settings.goal = Number($("#daily-goal").value);
  state.settings.banks = banks;
  state.settings.provider = $("#translation-provider").value;
  saveState();
  $("#settings-dialog").close();
  renderBanks();
  renderDashboard();
  renderReview();
  renderProgress();
  showToast("Your daily plan is ready");
}

function toggleBank(bank, enabled) {
  const current = new Set(state.settings.banks);
  enabled ? current.add(bank) : current.delete(bank);
  if (!current.size) {
    showToast("Keep at least one word bank active");
    renderBanks();
    return;
  }
  state.settings.banks = [...current];
  saveState();
  renderBanks();
  renderDashboard();
  renderReview();
}

function openSearch() {
  $("#search-dialog").showModal();
  $("#word-search").value = "";
  $("#search-results").innerHTML = "<p>Search by spelling. Meanings stay in simple English.</p>";
  setTimeout(() => $("#word-search").focus(), 30);
}

function searchLocal(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    $("#search-results").innerHTML = "<p>Search by spelling. Meanings stay in simple English.</p>";
    return;
  }
  const matches = words.filter((word) => word.word.toLowerCase().includes(normalized)).slice(0, 8);
  $("#search-results").innerHTML = matches.length
    ? matches.map((word) => `<button class="search-result" type="button" data-search-word="${word.id}"><strong>${word.word}</strong><span>${word.bank}</span><small>${word.definition}</small></button>`).join("")
    : `<p>No enriched match. Press Enter to look up “${escapeHtml(normalized)}” in the live English dictionary.</p>`;
}

async function lookupRemote(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return;
  $("#search-results").innerHTML = "<p>Looking for a plain English meaning…</p>";
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    const meaning = data[0].meanings[0];
    const definition = meaning.definitions[0];
    const tempWord = {
      id: `live-${normalized}`, word: normalized, phonetic: data[0].phonetic || "", pos: meaning.partOfSpeech,
      bank: "LIVE", topic: "Dictionary", definition: definition.definition,
      scene: `Create one clear, personal scene where “${normalized}” is happening.`, emoji: "💭",
      example: definition.example || `Say a short sentence with “${normalized}” that is true for you.`, source: "Free Dictionary API · live lookup",
    };
    words = words.filter((word) => word.id !== tempWord.id).concat(tempWord);
    $("#search-results").innerHTML = `<button class="search-result" type="button" data-search-word="${tempWord.id}"><strong>${tempWord.word}</strong><span>LIVE</span><small>${tempWord.definition}</small></button>`;
  } catch {
    $("#search-results").innerHTML = "<p>The live dictionary could not find that word.</p>";
  }
}

async function importWords(file) {
  try {
    const text = await file.text();
    const imported = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCsv(text);
    if (!Array.isArray(imported)) throw new Error("The file must contain a list of words");
    const normalized = imported.map((item, index) => normalizeImportedWord(item, index)).filter(Boolean);
    state.customWords = [...state.customWords, ...normalized.filter((item) => !words.some((word) => word.id === item.id))];
    words = [...window.WORD_DATA, ...state.customWords];
    saveState();
    renderBanks();
    renderDashboard();
    showToast(`${normalized.length} licensed words imported`);
  } catch (error) {
    showToast(error.message || "That word-bank file could not be read");
  }
}

function normalizeImportedWord(item, index) {
  const word = String(item.word || "").trim().toLowerCase();
  const definition = String(item.definition || item.simpleDefinition || "").trim();
  if (!word || !definition) return null;
  const bank = ["CET4", "CET6", "IELTS"].includes(item.bank) ? item.bank : "IELTS";
  return {
    id: item.id || `import-${bank.toLowerCase()}-${word}-${index}`,
    word, bank, definition, phonetic: item.phonetic || "", pos: item.pos || "word",
    topic: item.topic || "Imported", scene: item.scene || `Picture a real moment where “${word}” is happening.`,
    emoji: item.emoji || "💭", example: item.example || `Use “${word}” in a true sentence about your life.`,
    source: item.source || "Licensed import", sourceUrl: item.sourceUrl || "", chinese: item.chinese || "",
  };
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map((value) => value.trim());
  return lines.map((line) => {
    const values = line.match(/("[^"]*(?:""[^"]*)*"|[^,]*)(?:,|$)/g)?.map((value) => value.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) || [];
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2400);
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$('[data-go-view]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.goView)));
  $(".mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("#open-settings").addEventListener("click", openSettings);
  $("#header-settings").addEventListener("click", openSettings);
  $$('[data-open-settings]').forEach((button) => button.addEventListener("click", openSettings));
  $("#daily-goal").addEventListener("input", (event) => { $("#goal-output").textContent = event.target.value; });
  $("#save-settings").addEventListener("click", saveSettings);
  $("#start-session").addEventListener("click", () => startSession(getPlan().queue));
  $("#start-review").addEventListener("click", () => startSession(getDueWords(), "review"));
  $(".study-close").addEventListener("click", closeStudy);
  $("#speak-word").addEventListener("click", speakCurrentWord);
  $("#reveal-chinese").addEventListener("click", revealChinese);
  $$(".answer-button").forEach((button) => button.addEventListener("click", () => answerWord(button.dataset.answer)));
  $("#open-search").addEventListener("click", openSearch);
  $("#close-search").addEventListener("click", () => $("#search-dialog").close());
  $("#word-search").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchLocal(event.target.value), 120);
  });
  $("#word-search").addEventListener("keydown", (event) => { if (event.key === "Enter") lookupRemote(event.target.value); });
  $("#word-import").addEventListener("change", (event) => { if (event.target.files[0]) importWords(event.target.files[0]); });

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-bank-toggle]");
    if (toggle) {
      event.stopPropagation();
      toggleBank(toggle.dataset.bankToggle, toggle.checked);
    }
    const practice = event.target.closest("[data-practice-word]");
    if (practice) startSession([words.find((word) => word.id === practice.dataset.practiceWord)], "mistake");
    const result = event.target.closest("[data-search-word]");
    if (result) {
      const word = words.find((item) => item.id === result.dataset.searchWord);
      $("#search-dialog").close();
      startSession([word], "search");
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
    if ($("#study-overlay").classList.contains("open")) {
      if (event.key === "1") answerWord("forgot");
      if (event.key === "2") answerWord("hard");
      if (event.key === "3") answerWord("got");
      if (event.key === "Escape") closeStudy();
    }
  });
}

init();
