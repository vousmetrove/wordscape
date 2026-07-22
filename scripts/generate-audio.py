"""Generate committed pronunciation audio for every enriched seed word."""

import asyncio
import re
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data.js"
AUDIO_DIR = ROOT / "audio"
VOICES = {
    "gb": "en-GB-SoniaNeural",
    "us": "en-US-JennyNeural",
    "au": "en-AU-NatashaNeural",
}


async def generate_one(word: str, accent: str, voice: str, semaphore: asyncio.Semaphore) -> None:
    output = AUDIO_DIR / word / f"{accent}.mp3"
    if output.exists() and output.stat().st_size > 500:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    async with semaphore:
        await edge_tts.Communicate(word, voice, rate="-12%").save(str(output))
        print(f"generated {word}/{accent}.mp3")


async def main() -> None:
    source = DATA_FILE.read_text(encoding="utf-8")
    words = sorted(set(re.findall(r'id:\s*"[^"]+",\s*word:\s*"([a-z-]+)"', source)))
    if not words:
        raise RuntimeError("No seed words found in data.js")
    semaphore = asyncio.Semaphore(6)
    tasks = [generate_one(word, accent, voice, semaphore) for word in words for accent, voice in VOICES.items()]
    await asyncio.gather(*tasks)
    print(f"ready: {len(words)} words × {len(VOICES)} accents")


if __name__ == "__main__":
    asyncio.run(main())
