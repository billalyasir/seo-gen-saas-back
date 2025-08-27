// controllers/seo-gen.js
const OpenAI = require("openai");

const FileCount = require("../models/UserFileCount");
const MAX_TITLE = 60;
const MAX_SHORT = 120;
const MAX_LONG = 220;

const BATCH_SIZE = 50;

/** Normalize incoming lang to a canonical language pair. */
function normalizeLanguage(input) {
  const raw = String(input || "").trim();

  const greekAliases = new Set(
    [
      "EL",
      "GR",
      "EL-GR",
      "GREEK",
      "ΕΛ",
      "ΕΛΛΗΝΙΚΑ",
      "ΕΛΛΗΝΙΚΆ",
      "Ελληνικά",
      "ellinika",
    ].map((s) => s.toLowerCase())
  );

  const englishAliases = new Set(
    ["EN", "EN-US", "EN-GB", "ENGLISH"].map((s) => s.toLowerCase())
  );

  const lower = raw.toLowerCase();
  if (greekAliases.has(lower)) {
    return { code: "EL", name: "Greek", scriptNote: "Greek script (Ελληνικά)" };
  }
  if (englishAliases.has(lower) || !raw) {
    return { code: "EN", name: "English", scriptNote: "Latin script" };
  }

  if (lower.includes("greek") || lower.includes("ελλην")) {
    return { code: "EL", name: "Greek", scriptNote: "Greek script (Ελληνικά)" };
  }
  return { code: "EN", name: "English", scriptNote: "Latin script" };
}

function buildSchema(seoTargets) {
  const props = { id: { anyOf: [{ type: "string" }, { type: "number" }] } };
  if (seoTargets.includes("title"))
    props.seoTitle = { type: "string", maxLength: MAX_TITLE };
  if (seoTargets.includes("short description"))
    props.seoShort = { type: "string", maxLength: MAX_SHORT };
  if (seoTargets.includes("long description"))
    props.seoLong = { type: "string", maxLength: MAX_LONG };
  return {
    name: "SEOArray",
    schema: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: props,
      },
    },
    strict: true,
  };
}

function buildPrompt({ products, seoTargets, langNorm }) {
  const targetsLine = `Targets: ${seoTargets.join(", ")}.`;
  const limitsLine = `Limits: seoTitle ≤ ${MAX_TITLE}, seoShort ≤ ${MAX_SHORT}, seoLong ≤ ${MAX_LONG}.`;

  const system = [
    "You are an SEO copywriter.",
    "Output ONLY valid JSON matching the provided schema.",
    targetsLine,
    limitsLine,
    "Each requested field MUST be semantically distinct from the others (no duplicates, no trivial paraphrases).",
    "Title should be a compact headline; short description a 1–2 sentence summary; long description adds extra detail not found verbatim in the others.",
    `Language requirement: Write all requested fields ONLY in ${langNorm.name}. Use the ${langNorm.scriptNote}.`,
    "Do not mix languages. If Greek is requested, do NOT use English.",
    "Never hallucinate specifications; keep generic if details are missing.",
    "No emojis or salesy fluff. No repeated punctuation.",
    "No brand/trademark claims unless explicitly present in input.",
  ].join(" ");

  const user = `
Return ONE array with the same order and length as the input.
Each object MUST include "id" and ONLY the requested fields:
- "seoTitle" if "title" requested
- "seoShort" if "short description" requested
- "seoLong"  if "long description" requested

IMPORTANT:
- The three fields MUST be different from each other. Do NOT reuse sentences across fields.
- The title should be a compact headline; the short description should summarize; the long description should add detail.

Products:
${JSON.stringify(products, null, 2)}
`.trim();

  return { system, user };
}

function clipRow(row) {
  const out = { id: row.id };
  if (row.seoTitle != null)
    out.seoTitle = String(row.seoTitle).slice(0, MAX_TITLE);
  if (row.seoShort != null)
    out.seoShort = String(row.seoShort).slice(0, MAX_SHORT);
  if (row.seoLong != null) out.seoLong = String(row.seoLong).slice(0, MAX_LONG);
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** --- Helpers for distinctness enforcement --- */
function normalizeForCompare(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tooSimilar(a, b) {
  const A = normalizeForCompare(a);
  const B = normalizeForCompare(b);
  if (!A || !B) return false;
  if (A === B) return true;
  if (A.length > 10 && (A.includes(B) || B.includes(A))) return true;

  const aSet = new Set(A.split(" "));
  const bSet = new Set(B.split(" "));
  let overlap = 0;
  for (const t of aSet) if (bSet.has(t)) overlap++;
  const jaccard = overlap / (aSet.size + bSet.size - overlap || 1);
  return jaccard >= 0.7;
}

function firstNonOverlappingChunks(allText, avoidList, maxLen) {
  const parts = String(allText || "")
    .split(/[•·\-\u2013\u2014,.;:|/()\[\]\n]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const p of parts) {
    if (!avoidList.some((v) => tooSimilar(p, v))) {
      return p.slice(0, maxLen);
    }
  }
  return String(allText || "").slice(0, maxLen);
}

function enforceDistinct(row, product) {
  const allText = Object.keys(product || {})
    .filter((k) => k !== "id")
    .map((k) => String(product[k] || ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const out = { ...row };
  const title = out.seoTitle || "";
  let short = out.seoShort || "";
  let long = out.seoLong || "";

  if (short && tooSimilar(short, title)) {
    short = firstNonOverlappingChunks(allText, [title], MAX_SHORT);
  }
  if (long && (tooSimilar(long, title) || tooSimilar(long, short))) {
    long = firstNonOverlappingChunks(allText, [title, short], MAX_LONG);
  }
  if (title && (tooSimilar(title, short) || tooSimilar(title, long))) {
    const rebuiltTitle = firstNonOverlappingChunks(
      allText,
      [short, long],
      MAX_TITLE
    );
    out.seoTitle = rebuiltTitle || title.slice(0, MAX_TITLE);
  } else {
    out.seoTitle = title.slice(0, MAX_TITLE);
  }

  out.seoShort = short
    ? short.slice(0, MAX_SHORT)
    : firstNonOverlappingChunks(allText, [out.seoTitle], MAX_SHORT);
  out.seoLong = long
    ? long.slice(0, MAX_LONG)
    : firstNonOverlappingChunks(
        allText,
        [out.seoTitle, out.seoShort],
        MAX_LONG
      );

  return out;
}

async function callOnce(client, { products, seoTargets, langNorm }) {
  const { system, user } = buildPrompt({ products, seoTargets, langNorm });

  const resp = await client.responses.create({
    model: process.env.SEO_MODEL || "gpt-4.1",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: buildSchema(seoTargets),
    },
    temperature: 0.6,
  });

  const text = resp.output_text || "[]";
  const arr = JSON.parse(text);
  return arr.map((row, i) => enforceDistinct(clipRow(row), products[i]));
}

/**
 * Main endpoint
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

    const langNorm = normalizeLanguage(lang);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const batches = chunk(products, BATCH_SIZE);
    const out = [];
    for (const batch of batches) {
      try {
        const rows = await callOnce(client, {
          products: batch,
          seoTargets,
          langNorm,
        });
        out.push(...rows);
      } catch (e) {
        for (const p of batch) {
          const fallback = { id: p.id };
          const allText = Object.keys(p)
            .filter((k) => k !== "id")
            .map((k) => String(p[k] || ""))
            .join(" ")
            .trim();

          const makeGreek = (t) => `Προϊόν: ${t}`.replace(/\s+/g, " ").trim();

          if (seoTargets.includes("title")) {
            const t = allText.slice(0, MAX_TITLE);
            fallback.seoTitle = langNorm.code === "EL" ? makeGreek(t) : t;
          }
          if (seoTargets.includes("short description")) {
            const t = allText.slice(0, MAX_SHORT);
            fallback.seoShort = langNorm.code === "EL" ? makeGreek(t) : t;
          }
          if (seoTargets.includes("long description")) {
            const t = allText.slice(0, MAX_LONG);
            fallback.seoLong = langNorm.code === "EL" ? makeGreek(t) : t;
          }
          out.push(enforceDistinct(fallback, p));
        }
      }
    }

    if (out.length > 0) {
      let count = await FileCount.findOne({ user: req.user.id });
      if (!count) {
        count = new FileCount({ user: req.user.id, count: 1 });
      } else {
        count.count += 1;
      }
      await count.save();
    }

    return res.json({ data: out });
  } catch (err) {
    console.error("SEO generation error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

module.exports = { generateSEO };

//check that short description too, seo title
