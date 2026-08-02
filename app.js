const STORAGE_KEY = "wordscape-listening-dictation-v1";
const library = Array.isArray(window.LISTENING_WORD_DATA) ? window.LISTENING_WORD_DATA : [];
const meta = window.LISTENING_LIBRARY_META || { total: library.length, rawRows: library.length, chapters: [] };

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const defaultState = {
  chapter: meta.chapters?.[0] || "all",
  repeatCount: 3,
  speechRate: 1,
  progress: {},
};

let state = loadState();
let correctStreak = 0;
let attemptNumber = 0;
let currentEntry = null;
let playToken = 0;
let isPlaying = false;
let advanceTimer = null;
let toastTimer = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...defaultState,
      ...saved,
      progress: { ...defaultState.progress, ...(saved.progress || {}) },
    };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normaliseAnswer(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .toLocaleLowerCase();
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function displayCharacter(character) {
  if (character === undefined || character === "") return "＿";
  if (character === " ") return "·";
  return escapeHTML(character);
}

function chapterWords(chapter = state.chapter) {
  if (chapter === "all") return library;
  return library.filter((entry) => (entry.chapters || []).includes(chapter));
}

function chapterIndex(chapter = state.chapter) {
  const words = chapterWords(chapter);
  if (!words.length) return 0;
  return Math.max(0, Number(state.progress[chapter]) || 0) % words.length;
}

function buildChapterSelect() {
  const select = $("#chapter-select");
  select.innerHTML = "";
  const chapters = meta.chapters?.length ? meta.chapters : [...new Set(library.flatMap((entry) => entry.chapters || []))];

  const allOption = new Option(`全部章节 · ${library.length.toLocaleString()} 词`, "all");
  select.add(allOption);
  chapters.forEach((chapter) => {
    const count = library.filter((entry) => (entry.chapters || []).includes(chapter)).length;
    select.add(new Option(`${chapter} · ${count.toLocaleString()} 词`, chapter));
  });

  const validValues = ["all", ...chapters];
  if (!validValues.includes(state.chapter)) state.chapter = chapters[0] || "all";
  select.value = state.chapter;
}

function init() {
  $("#library-total").textContent = Number(meta.total || library.length).toLocaleString();
  $("#library-chapters").textContent = (meta.chapters || []).length.toLocaleString();
  buildChapterSelect();

  $("#repeat-select").value = String(state.repeatCount || 3);
  $("#speed-select").value = String(state.speechRate || 1);
  bindEvents();
  renderWord();
}

function renderWord() {
  clearTimeout(advanceTimer);
  stopAudio(false);
  correctStreak = 0;
  attemptNumber = 0;
  renderStreak();

  const words = chapterWords();
  const index = chapterIndex();
  currentEntry = words[index] || null;

  $("#attempt-list").innerHTML = "";
  $("#word-complete").hidden = true;
  $("#dictation-card").classList.remove("complete");
  $("#current-chapter").textContent = state.chapter === "all" ? "ALL CHAPTERS" : `CHAPTER ${state.chapter}`;
  $("#word-position").textContent = words.length ? index + 1 : 0;
  $("#chapter-word-total").textContent = words.length.toLocaleString();
  $("#chapter-progress-fill").style.width = words.length ? `${((index + 1) / words.length) * 100}%` : "0%";

  if (!currentEntry) {
    $("#word-phonetic").textContent = "/ /";
    $("#word-chinese").textContent = "该章节没有词汇";
    $("#play-audio").disabled = true;
    $("#attempt-label").textContent = "请选择其他章节";
    return;
  }

  const phonetic = currentEntry.phonetic
    ? `/${currentEntry.phonetic.replace(/^\/+|\/+$/g, "")}/`
    : "暂无音标";
  $("#word-phonetic").textContent = phonetic;
  $("#word-chinese").textContent = currentEntry.chinese;
  $("#play-audio").disabled = false;
  $("#attempt-label").textContent = "等待第 1 次输入";
  updateAudioStatus();
  addAttemptInput();
}

function renderStreak() {
  $("#correct-count").textContent = correctStreak;
  $$("#streak-indicator i").forEach((dot, index) => dot.classList.toggle("filled", index < correctStreak));
}

function addAttemptInput() {
  attemptNumber += 1;
  const form = document.createElement("form");
  form.className = "attempt-row active";
  form.innerHTML = `
    <label>
      <span>第 ${attemptNumber} 次输入</span>
      <input type="text" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="第 ${attemptNumber} 次拼写输入" placeholder="输入完整单词" />
    </label>
    <button type="submit">确认</button>
    <div class="attempt-feedback" hidden></div>`;
  form.addEventListener("submit", handleAttempt);
  $("#attempt-list").appendChild(form);
  $("#attempt-label").textContent = `等待第 ${attemptNumber} 次输入`;

  requestAnimationFrame(() => {
    const input = $("input", form);
    input.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function handleAttempt(event) {
  event.preventDefault();
  if (!currentEntry) return;

  const form = event.currentTarget;
  const input = $("input", form);
  const button = $("button", form);
  const feedback = $(".attempt-feedback", form);
  const typed = input.value.trim();

  if (!typed) {
    input.classList.add("shake");
    setTimeout(() => input.classList.remove("shake"), 360);
    showToast("请先输入你听到的单词");
    return;
  }

  input.disabled = true;
  button.disabled = true;
  form.classList.remove("active");
  feedback.hidden = false;

  const isCorrect = normaliseAnswer(typed) === normaliseAnswer(currentEntry.word);
  if (isCorrect) {
    correctStreak += 1;
    form.classList.add("correct");
    feedback.innerHTML = `<p class="correct-message"><span>✓</span> 拼写正确，连续正确 ${correctStreak}/3</p>`;
    renderStreak();

    if (correctStreak >= 3) {
      completeCurrentWord();
    } else {
      addAttemptInput();
    }
    return;
  }

  correctStreak = 0;
  form.classList.add("wrong");
  feedback.innerHTML = buildDifference(currentEntry.word, typed);
  renderStreak();
  $("#attempt-label").textContent = "错误位置已标红，重新开始连续计数";
  addAttemptInput();
}

function buildDifference(target, typed) {
  const expected = Array.from(target);
  const actual = Array.from(typed);
  const length = Math.max(expected.length, actual.length);
  let expectedMarkup = "";
  let actualMarkup = "";

  for (let index = 0; index < length; index += 1) {
    const expectedCharacter = expected[index] ?? "";
    const actualCharacter = actual[index] ?? "";
    const matches = normaliseAnswer(expectedCharacter) === normaliseAnswer(actualCharacter) && expectedCharacter !== "";
    const className = matches ? "char-match" : "char-error";
    expectedMarkup += `<span class="${className}">${displayCharacter(expectedCharacter)}</span>`;
    actualMarkup += `<span class="${className}">${displayCharacter(actualCharacter)}</span>`;
  }

  return `
    <div class="wrong-message"><span>×</span><p><strong>拼写有误</strong><small>错误或缺少的位置已标红，连续正确次数归零。</small></p></div>
    <div class="difference-panel">
      <div><small>正确拼写</small><code>${expectedMarkup}</code></div>
      <div><small>你的输入</small><code>${actualMarkup}</code></div>
    </div>`;
}

function completeCurrentWord() {
  stopAudio(false);
  $("#dictation-card").classList.add("complete");
  $("#completed-word").textContent = currentEntry.word;
  $("#word-complete").hidden = false;
  $("#attempt-label").textContent = "连续三次正确";
  $("#word-complete").scrollIntoView({ behavior: "smooth", block: "nearest" });

  const completedChapter = state.chapter;
  const words = chapterWords(completedChapter);
  const currentIndex = chapterIndex(completedChapter);
  state.progress[completedChapter] = words.length ? (currentIndex + 1) % words.length : 0;
  saveState();

  advanceTimer = setTimeout(() => {
    if (state.chapter === completedChapter) renderWord();
  }, 1400);
}

function selectVoice(locale = "en-GB") {
  const voices = speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang.toLocaleLowerCase() === locale.toLocaleLowerCase())
    || voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith("en"))
    || null;
}

function speakOnce(word, token) {
  return new Promise((resolve) => {
    if (token !== playToken) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-GB";
    utterance.rate = Number(state.speechRate) || 1;
    const voice = selectVoice("en-GB");
    if (voice) utterance.voice = voice;
    utterance.addEventListener("end", resolve, { once: true });
    utterance.addEventListener("error", resolve, { once: true });
    speechSynthesis.speak(utterance);
  });
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function playCurrentWord() {
  if (!currentEntry) return;
  if (!("speechSynthesis" in window)) {
    showToast("当前浏览器不支持语音播放，请使用最新版 Edge、Chrome 或 Safari");
    return;
  }
  if (isPlaying) {
    stopAudio();
    return;
  }

  stopAudio(false);
  const token = ++playToken;
  const repeatCount = Number(state.repeatCount) || 1;
  isPlaying = true;
  $("#play-audio").classList.add("playing");
  $("#play-audio strong").textContent = "点击停止播放";

  for (let index = 0; index < repeatCount; index += 1) {
    if (token !== playToken) break;
    $("#audio-status").textContent = `正在播放第 ${index + 1} / ${repeatCount} 遍`;
    await speakOnce(currentEntry.word, token);
    if (token === playToken && index < repeatCount - 1) await pause(420);
  }

  if (token === playToken) stopAudio();
}

function stopAudio(updateStatus = true) {
  playToken += 1;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  isPlaying = false;
  $("#play-audio")?.classList.remove("playing");
  const label = $("#play-audio strong");
  if (label) label.textContent = "点击播放发音";
  if (updateStatus) updateAudioStatus();
}

function updateAudioStatus() {
  const repeatCount = Number(state.repeatCount) || 1;
  const rate = Number(state.speechRate) || 1;
  $("#audio-status").textContent = `每次播放 ${repeatCount} 遍 · ${rate}× 语速 · 英式发音`;
}

function bindEvents() {
  $("#chapter-select").addEventListener("change", (event) => {
    state.chapter = event.target.value;
    saveState();
    renderWord();
  });

  $("#repeat-select").addEventListener("change", (event) => {
    state.repeatCount = Number(event.target.value) || 1;
    saveState();
    stopAudio();
  });

  $("#speed-select").addEventListener("change", (event) => {
    state.speechRate = Number(event.target.value) || 1;
    saveState();
    stopAudio();
  });

  $("#play-audio").addEventListener("click", playCurrentWord);
  window.addEventListener("beforeunload", () => stopAudio(false));
  if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", () => selectVoice());
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2600);
}

init();
