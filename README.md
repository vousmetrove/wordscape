# Wordscape — think in English

Wordscape is an English-first vocabulary learning website for Chinese learners. It replaces automatic word-to-Chinese matching with three active memory anchors:

1. a very simple English definition;
2. immediate spoken retrieval;
3. one short sentence created by the learner.

Chinese stays hidden unless the learner explicitly asks for it.

## What works now

- Flexible daily target with any positive number and quick presets up to 200
- CET-4, CET-6, and IELTS categories
- Reviews automatically reserve the first places inside the daily target while staying in a separate assessment space
- Ebbinghaus-style intervals at 1, 2, 4, 7, 15, 30, and 60 days
- Three failed recalls automatically move a word into the mistake book
- Words leave the mistake book after reaching memory stage 3 again
- Matching browser speech voice only as a final fallback for imported words
- Committed British, American, and Australian neural-voice MP3 files for every enriched seed word
- Azure Speech fallback for imported words, using separate UK, US, and AU voices
- On-demand Chinese through a server-side Youdao or Oxford adapter
- Live English lookup through the Free Dictionary API
- Local progress, streak, recall rate, and seven-day review load
- JSON/CSV import for licensed word books and authentic exam sentences
- Responsive desktop and mobile layouts

The repository includes 30 manually rewritten, fully enriched seed words, 90 pronunciation recordings, and a synchronized 4,020-word CET syllabus list. The raw CET list is deliberately kept separate: words should not enter the learning queue until they have a checked plain-English definition, visual, and source-safe sentence.

## Run locally

The core website is static. Open `index.html`, or serve the folder:

```bash
python -m http.server 4173
```

Then visit `http://localhost:4173`.

The translation route is a Vercel-compatible server function. To test that route locally, use the Vercel development server and copy `.env.example` to `.env.local` with your own credentials.

## Translation configuration

Configure one or both providers as server environment variables:

```text
YOUDAO_APP_KEY=
YOUDAO_APP_SECRET=
OXFORD_APP_ID=
OXFORD_APP_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

Secrets are never stored in browser code. If a provider is not configured, the 30 seed words fall back to their local Chinese hints after the learner explicitly clicks “I still need Chinese”.

## Word-bank import

Use `data/import-template.json` as the schema. Required fields are:

- `word`
- `definition` (simple English)

Recommended fields are `bank`, `phonetic`, `pos`, `topic`, `example`, `source`, `sourceUrl`, and `chinese`. Images, videos, scenes, and emoji cues are deliberately ignored because a weak visual match can teach the wrong meaning.

## Learning and assessment

The learning card is not a scored test, but it cannot be skipped passively:

1. **Understand:** play at least one regional pronunciation, read one short English definition, and notice the word in context.
2. **Retrieve:** the spelling and definition close; say the word and explain it aloud from memory.
3. **Use:** write one short personal English sentence containing the word. The sentence is stored locally with the memory record.

Assessment lives in the separate Review view:

1. play British, American, or Australian audio while spelling and meaning stay hidden;
2. repeat the word aloud;
3. answer only whether its meaning is present in your mind.

A “not yet” answer resets the memory stage and adds one failed recall. After three failed recalls, the word enters the mistake book automatically.

## Regenerate local pronunciation files

```bash
python scripts/generate-audio.py
```

The script uses the British `en-GB-SoniaNeural`, American `en-US-JennyNeural`, and Australian `en-AU-NatashaNeural` voices. Generated files are stored under `audio/<word>/<accent>.mp3` and work without runtime API credentials.

For authentic exam sentences, only import material you have permission to publish. Every sentence should keep its exam/book name, year, section, and source URL. Do not label generated or adapted examples as authentic exam text.

## Refresh the public CET list

```bash
node scripts/sync-cet.mjs
```

This writes `data/cet-4-6-raw.json` with source, license, sync date, and a deduplicated list.

## Data and API sources

- CET vocabulary: [JavaProgrammerLB/cet-word-list](https://github.com/JavaProgrammerLB/cet-word-list), MIT licensed and transcribed from the 2016 National College English Test syllabus.
- English live lookup: [Free Dictionary API](https://dictionaryapi.dev/), used only when the learner searches for a word not yet enriched locally.
- Chinese fallback: [Youdao Natural Language Translation API](https://ai.youdao.com/DOCSIRMA/html/trans/api/plwbfy/index.html) or [Oxford Dictionaries API](https://developer.oxforddictionaries.com/endpoints), using the account holder’s own credentials and provider terms.
- Regional pronunciation: [Azure Speech language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support) and its [text-to-speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech).

IELTS is not a single official fixed vocabulary list. The built-in IELTS seed is an original thematic curation. Commercial IELTS word books and their example sentences are not copied into this repository; licensed data can be imported using the provided schema.

## Project structure

```text
wordscape/
├── api/translate.js          # Youdao and Oxford server-side adapters
├── api/speech.js             # Azure UK, US, and AU speech fallback
├── audio/                    # 90 committed regional pronunciation files
├── data/
│   ├── cet-4-6-raw.json      # Public CET syllabus vocabulary
│   └── import-template.json  # Licensed data schema
├── scripts/sync-cet.mjs      # Reproducible CET vocabulary sync
├── scripts/generate-audio.py # Reproducible three-accent audio generation
├── index.html                # App views and study interface
├── styles.css                # Responsive visual system
├── data.js                   # Enriched English-first seed words
└── app.js                    # Scheduling, study, search, import, and progress
```

## Privacy

Study records stay in the browser’s `localStorage`. A translation request sends only the selected English word to the chosen provider after the learner requests Chinese.

## License

Application code is MIT licensed. Imported or synchronized datasets retain their own licenses and source terms.
