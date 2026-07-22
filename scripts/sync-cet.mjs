import { mkdir, writeFile } from "node:fs/promises";

const SOURCE = "https://raw.githubusercontent.com/JavaProgrammerLB/cet-word-list/master/word-list.txt";
const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`CET source returned ${response.status}`);

const raw = await response.text();
const words = [...new Set(raw.split(/\r?\n/).map((word) => word.trim().toLowerCase()).filter((word) => /^[a-z][a-z'-]*$/.test(word)))];

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/cet-4-6-raw.json", import.meta.url), JSON.stringify({
  source: "National College English Test syllabus (2016 revision), transcribed by JavaProgrammerLB/cet-word-list",
  license: "MIT",
  sourceUrl: "https://github.com/JavaProgrammerLB/cet-word-list",
  syncedAt: new Date().toISOString(),
  count: words.length,
  words,
}, null, 2));

console.log(`Saved ${words.length} CET words to data/cet-4-6-raw.json`);
