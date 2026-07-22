const VOICES = {
  gb: { locale: "en-GB", name: "en-GB-SoniaNeural" },
  us: { locale: "en-US", name: "en-US-JennyNeural" },
  au: { locale: "en-AU", name: "en-AU-NatashaNeural" },
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const word = String(req.query.word || "").trim().toLowerCase();
  const accent = String(req.query.accent || "gb").toLowerCase();
  if (!/^[a-z][a-z\s'-]{0,48}$/.test(word)) return res.status(400).json({ error: "Invalid word" });
  if (!VOICES[accent]) return res.status(400).json({ error: "Unsupported accent" });

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) return res.status(503).json({ error: "Azure Speech is not configured" });

  const voice = VOICES[accent];
  const escaped = word.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]));
  const ssml = `<speak version="1.0" xml:lang="${voice.locale}"><voice name="${voice.name}"><prosody rate="-10%">${escaped}</prosody></voice></speak>`;

  try {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "wordscape",
      },
      body: ssml,
    });
    if (!response.ok) return res.status(502).json({ error: `Azure Speech returned ${response.status}` });
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=2592000");
    return res.status(200).send(audio);
  } catch {
    return res.status(502).json({ error: "Speech synthesis failed" });
  }
};
