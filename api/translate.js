const crypto = require("node:crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const word = String(req.query.word || "").trim().toLowerCase();
  const provider = String(req.query.provider || "youdao").toLowerCase();
  if (!/^[a-z][a-z\s'-]{0,48}$/.test(word)) return res.status(400).json({ error: "Invalid word" });

  try {
    const translation = provider === "oxford" ? await translateWithOxford(word) : await translateWithYoudao(word);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ word, provider, translation });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
};

async function translateWithYoudao(word) {
  const appKey = process.env.YOUDAO_APP_KEY;
  const appSecret = process.env.YOUDAO_APP_SECRET;
  if (!appKey || !appSecret) throw new Error("Youdao credentials are not configured");

  const salt = crypto.randomUUID();
  const curtime = String(Math.floor(Date.now() / 1000));
  const input = word.length <= 20 ? word : `${word.slice(0, 10)}${word.length}${word.slice(-10)}`;
  const sign = crypto.createHash("sha256").update(`${appKey}${input}${salt}${curtime}${appSecret}`).digest("hex");
  const body = new URLSearchParams({
    q: word, from: "en", to: "zh-CHS", appKey, salt, sign, signType: "v3", curtime,
  });

  const response = await fetch("https://openapi.youdao.com/v2/api", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Youdao request failed");
  const data = await response.json();
  const translated = data.translateResults?.[0]?.translation || data.translation?.[0];
  if (!translated) throw new Error(`Youdao returned error ${data.errorCode || "unknown"}`);
  return translated;
}

async function translateWithOxford(word) {
  const appId = process.env.OXFORD_APP_ID;
  const appKey = process.env.OXFORD_APP_KEY;
  if (!appId || !appKey) throw new Error("Oxford credentials are not configured");

  const url = `https://od-api.oxforddictionaries.com/api/v2/translations/en/zh/${encodeURIComponent(word)}`;
  const response = await fetch(url, { headers: { app_id: appId, app_key: appKey } });
  if (!response.ok) throw new Error("Oxford request failed");
  const data = await response.json();
  const translations = [];
  for (const result of data.results || []) {
    for (const lexical of result.lexicalEntries || []) {
      for (const entry of lexical.entries || []) {
        for (const sense of entry.senses || []) {
          for (const translation of sense.translations || []) translations.push(translation.text);
        }
      }
    }
  }
  if (!translations.length) throw new Error("Oxford returned no Chinese translation");
  return [...new Set(translations)].slice(0, 4).join("；");
}
