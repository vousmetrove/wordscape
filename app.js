const STORAGE_KEY = "wordscape-listening-dictation-v1";
const SPEECH_RATES = [1, 1.2, 1.4, 1.6];
const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
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
let correctCount = 0;
let attemptNumber = 0;
let currentEntry = null;
let playToken = 0;
let isPlaying = false;
let advanceTimer = null;
let toastTimer = null;
let cachedEnglishVoice = null;
let activeRecordedAudio = null;
let finishRecordedPlayback = null;
const pronunciationRequests = new Map();
const readyPronunciations = new Map();
const preloadedRecordings = new Map();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const savedRate = Number(saved.speechRate);
    return {
      ...defaultState,
      ...saved,
      speechRate: SPEECH_RATES.includes(savedRate) ? savedRate : defaultState.speechRate,
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
  correctCount = 0;
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
    setMeaningRevealed(true);
    $("#meaning-reveal").disabled = true;
    $("#play-audio").disabled = true;
    $("#attempt-label").textContent = "请选择其他章节";
    return;
  }

  const phonetic = currentEntry.phonetic
    ? `/${currentEntry.phonetic.replace(/^\/+|\/+$/g, "")}/`
    : "暂无音标";
  $("#word-phonetic").textContent = phonetic;
  $("#word-chinese").textContent = currentEntry.chinese;
  $("#meaning-reveal").disabled = false;
  setMeaningRevealed(false);
  $("#play-audio").disabled = false;
  $("#attempt-label").textContent = "等待第 1 次输入";
  updateAudioStatus();
  addAttemptInput();
  prepareDictionaryPronunciation(currentEntry.word);
  const nextEntry = words.length ? words[(index + 1) % words.length] : null;
  if (nextEntry && nextEntry.word !== currentEntry.word) prepareDictionaryPronunciation(nextEntry.word);
  playCurrentWord();
}

function renderStreak() {
  $("#correct-count").textContent = correctCount;
  $$("#streak-indicator i").forEach((dot, index) => dot.classList.toggle("filled", index < correctCount));
}

function setMeaningRevealed(revealed) {
  const button = $("#meaning-reveal");
  const meaning = $("#word-chinese");
  meaning.hidden = !revealed;
  button.classList.toggle("revealed", revealed);
  button.setAttribute("aria-expanded", String(revealed));
  $("#meaning-reveal-label").textContent = revealed ? "点击隐藏中文释义" : "点击查看中文释义";
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
    correctCount += 1;
    form.classList.add("correct");
    feedback.innerHTML = `<p class="correct-message"><span>✓</span> 拼写正确，累计正确 ${correctCount}/3</p>`;
    renderStreak();

    if (correctCount >= 3) {
      completeCurrentWord();
    } else {
      addAttemptInput();
    }
    return;
  }

  form.classList.add("wrong");
  feedback.innerHTML = buildDifference(currentEntry.word, typed);
  $("#attempt-label").textContent = `错误位置已标红，累计正确保留为 ${correctCount}/3`;
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
    <div class="wrong-message"><span>×</span><p><strong>拼写有误</strong><small>错误或缺少的位置已标红，已获得的正确次数继续保留。</small></p></div>
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
  $("#attempt-label").textContent = "累计三次正确";
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

function voiceQualityScore(voice) {
  const language = String(voice.lang || "").toLocaleLowerCase();
  const name = String(voice.name || "").toLocaleLowerCase();
  let score = 0;

  if (language === "en-gb") score += 120;
  else if (/^en-(ie|au|nz)/.test(language)) score += 85;
  else if (language.startsWith("en")) score += 55;
  else return -1;

  if (/natural|neural|premium|enhanced/.test(name)) score += 80;
  if (/sonia|libby|ryan|google uk english/.test(name)) score += 45;
  if (/hazel|george|susan|daniel/.test(name)) score += 25;
  if (voice.default) score += 5;
  return score;
}

function selectVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  cachedEnglishVoice = [...voices]
    .filter((voice) => voiceQualityScore(voice) >= 0)
    .sort((left, right) => voiceQualityScore(right) - voiceQualityScore(left))[0] || null;
  return cachedEnglishVoice;
}

function pronunciationKey(word) {
  return normaliseAnswer(word);
}

function normaliseAudioUrl(url = "") {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function pronunciationQualityScore(pronunciation) {
  const audio = String(pronunciation.audio || "").toLocaleLowerCase();
  let score = pronunciation.audio ? 10 : 0;
  if (/(?:-uk|_gb|[-_/]gb[-_.]|british)/.test(audio)) score += 100;
  else if (/(?:-au|[-_/]au[-_.])/.test(audio)) score += 55;
  else if (/(?:-us|_us|[-_/]us[-_.])/.test(audio)) score += 35;
  if (pronunciation.text) score += 5;
  return score;
}

function preloadRecording(url) {
  if (!url || !("Audio" in window)) return null;
  if (preloadedRecordings.has(url)) return preloadedRecordings.get(url);
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  preloadedRecordings.set(url, audio);
  return audio;
}

function prepareDictionaryPronunciation(word) {
  const key = pronunciationKey(word);
  if (!key || pronunciationRequests.has(key)) return pronunciationRequests.get(key) || Promise.resolve(null);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`${DICTIONARY_API}${encodeURIComponent(key)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const entries = await response.json();
      const pronunciations = entries.flatMap((entry) => entry.phonetics || []);
      const best = pronunciations
        .filter((pronunciation) => pronunciation.audio)
        .sort((left, right) => pronunciationQualityScore(right) - pronunciationQualityScore(left))[0];
      if (!best) return null;

      const result = {
        audio: normaliseAudioUrl(best.audio),
        phonetic: best.text || entries.find((entry) => entry.phonetic)?.phonetic || "",
      };
      readyPronunciations.set(key, result);
      preloadRecording(result.audio);

      if (currentEntry && pronunciationKey(currentEntry.word) === key) {
        if (result.phonetic) $("#word-phonetic").textContent = `/${result.phonetic.replace(/^\/+|\/+$/g, "")}/`;
        if (!isPlaying) updateAudioStatus();
      }
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  pronunciationRequests.set(key, request);
  return request;
}

function playRecordedOnce(pronunciation, token) {
  return new Promise((resolve) => {
    if (token !== playToken || !pronunciation?.audio) {
      resolve(false);
      return;
    }

    const audio = preloadRecording(pronunciation.audio);
    if (!audio) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (played) => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      if (activeRecordedAudio === audio) {
        activeRecordedAudio = null;
        finishRecordedPlayback = null;
      }
      resolve(played);
    };
    const onEnded = () => finish(true);
    const onError = () => finish(false);

    activeRecordedAudio = audio;
    finishRecordedPlayback = () => finish(false);
    audio.playbackRate = Number(state.speechRate) || 1;
    audio.currentTime = 0;
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.play().catch(onError);
  });
}

function speakSyntheticOnce(word, token) {
  return new Promise((resolve) => {
    if (token !== playToken || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-GB";
    utterance.rate = Number(state.speechRate) || 1;
    const voice = cachedEnglishVoice || selectVoice();
    if (voice) utterance.voice = voice;
    utterance.addEventListener("end", resolve, { once: true });
    utterance.addEventListener("error", resolve, { once: true });
    speechSynthesis.speak(utterance);
  });
}

async function playPronunciationOnce(word, token) {
  const dictionaryPronunciation = readyPronunciations.get(pronunciationKey(word));
  if (dictionaryPronunciation?.audio) {
    const played = await playRecordedOnce(dictionaryPronunciation, token);
    if (played || token !== playToken) return;
  }
  await speakSyntheticOnce(word, token);
}

async function playCurrentWord() {
  if (!currentEntry) return;
  if (!("speechSynthesis" in window) && !("Audio" in window)) {
    showToast("当前浏览器不支持音频播放，请使用最新版 Edge、Chrome 或 Safari");
    return;
  }
  if (isPlaying) {
    stopAudio();
    return;
  }

  const token = ++playToken;
  const repeatCount = Number(state.repeatCount) || 1;
  isPlaying = true;
  if ("speechSynthesis" in window) speechSynthesis.resume();
  $("#play-audio").classList.add("playing");
  $("#play-audio strong").textContent = "点击停止播放";

  for (let index = 0; index < repeatCount; index += 1) {
    if (token !== playToken) break;
    $("#audio-status").textContent = `正在播放第 ${index + 1} / ${repeatCount} 遍`;
    await playPronunciationOnce(currentEntry.word, token);
  }

  if (token === playToken) stopAudio();
}

function stopAudio(updateStatus = true) {
  playToken += 1;
  if (activeRecordedAudio) {
    activeRecordedAudio.pause();
    activeRecordedAudio.currentTime = 0;
  }
  finishRecordedPlayback?.();
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
  const hasRecording = Boolean(currentEntry && readyPronunciations.get(pronunciationKey(currentEntry.word))?.audio);
  const source = hasRecording ? "词典真人发音" : "优选英式发音";
  $("#audio-status").textContent = `每次播放 ${repeatCount} 遍 · ${rate}× 语速 · ${source}`;
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

  $("#meaning-reveal").addEventListener("click", () => {
    setMeaningRevealed($("#word-chinese").hidden);
  });

  const audioButton = $("#play-audio");
  audioButton.addEventListener("pointerdown", (event) => {
    if (event.button === 0) playCurrentWord();
  });
  audioButton.addEventListener("click", (event) => {
    if (event.detail === 0) playCurrentWord();
  });
  window.addEventListener("beforeunload", () => stopAudio(false));
  if ("speechSynthesis" in window) {
    selectVoice();
    speechSynthesis.addEventListener?.("voiceschanged", selectVoice);
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2600);
}

init();
