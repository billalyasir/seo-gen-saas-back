// controllers/seo-gen.js
const OpenAI = require("openai");

function coerceJsonArray(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = text.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {}
    }
    throw new Error("Failed to parse JSON from model output");
  }
}

/**
 * Body:
 * {
 *   products: [{ id, itemCode?, barcode?, description? }],
 *   seoTargets: ["title","short description","long description"],
 *   lang: "EN" | "EL"
 * }
 *
 * Returns:
 * [{ id, seoTitle?, seoShort?, seoLong? }, ...]
 */
async function generateSEO(req, res) {
  try {
    const {
      products,
      seoTargets = ["title", "short description", "long description"],
      lang = "EN",
    } = req.body || {};
    if (!Array.isArray(products) || products.length === 0) {
      return res
        .status(400)
        .json({ error: "Provide non-empty products array" });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = [
      "You are an SEO copywriter.",
      "Write output only as valid JSON (no markdown, no comments).",
      "For each product, include its id and ONLY the requested fields.",
      'Respect these limits: "seoTitle" ≤ 60 chars, "seoShort" ≤ 120 chars, "seoLong" ≤ 220 chars.',
      "Language: " + (lang || "EN"),
      "SEO targets requested: " + JSON.stringify(seoTargets),
    ].join(" ");

    const user = `
Given products:
${JSON.stringify(products, null, 2)}

Return a JSON array. Each object must include "id" and any of:
- "seoTitle" (if "title" was requested)
- "seoShort" (if "short description" was requested)
- "seoLong"  (if "long description" was requested)

Guidelines:
- Use any combination of itemCode, description, and barcode to craft concise, human-friendly copy.
- Never hallucinate specifications; keep things generic if details are missing.
- Avoid repeated punctuation, emojis, or salesy fluff.
- No trademark or brand claims unless present in input.
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.6,
    });

    const raw = completion.choices?.[0]?.message?.content || "[]";
    const parsed = coerceJsonArray(raw);

    const clipped = parsed.map((row) => {
      const out = { id: row.id };
      if (row.seoTitle != null)
        out.seoTitle = String(row.seoTitle).slice(0, 60);
      if (row.seoShort != null)
        out.seoShort = String(row.seoShort).slice(0, 120);
      if (row.seoLong != null) out.seoLong = String(row.seoLong).slice(0, 220);
      return out;
    });

    return res.json({ data: clipped });
  } catch (err) {
    console.error("SEO generation error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

module.exports = { generateSEO };
