// controllers/Image.js
const axios = require("axios");
const UserToken = require("../models/UserToken");
/** Dedup + normalize image URLs */
function getUniqueUrls(urls) {
  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    if (!url) continue;
    if (url.startsWith("x-raw-image")) continue;

    let base = url.split("?")[0];
    base = base.replace(/(\.jpg|\.jpeg|\.png|\.gif|\.bmp|\.svg)\.webp$/i, "$1");
    base = base.replace(/(\.webp|\.jpg|\.jpeg|\.png|\.gif|\.bmp|\.svg)$/i, "");

    if (!seen.has(base)) {
      seen.add(base);
      unique.push(url);
    }
  }
  return unique;
}

/** Simple exponential backoff for 429s */
async function withBackoff(fn, retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error?.response?.status !== 429 || i === retries - 1) throw error;
      const waitTime = delay * Math.pow(2, i);
      console.log(
        `Rate limit hit, retrying in ${waitTime / 1000}s (attempt ${
          i + 1
        }/${retries})`
      );
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }
  throw new Error("Max retries reached for rate limit");
}

/**
 * GET /api/images?q=query&num=5
 * - q: required (the search query, e.g., barcode, description, or any field value)
 * - num: optional (1..10). If omitted, falls back to env MAX_IMAGES_PER_QUERY or 5 (capped at 10)
 */
async function getImages(req, res) {
  const { q } = req.query;
  let { num } = req.query;
  const usertoken = await UserToken.findOne({ user: req.user.id });

  if (!q) {
    return res.status(400).json({ success: false, error: "Query required" });
  }

  try {
    const envMax = Math.min(
      parseInt(process.env.MAX_IMAGES_PER_QUERY || "5", 10),
      10
    );
    const desired = Math.max(
      1,
      Math.min(parseInt(num || envMax, 10) || envMax, 10)
    );

    const apiKey =
      process.env.GOOGLE_API_KEY || "AIzaSyCqzE5GJ-BZwFe6uJbNcfH3zxOds2u15Ro"; // move to env in prod
    const cseId = process.env.GOOGLE_CSE_ID || "231c131391d58460d";

    console.log(`Fetching images for query: ${q} (num=${desired})`);
    const { data } = await withBackoff(() =>
      axios.get("https://www.googleapis.com/customsearch/v1", {
        params: {
          key: apiKey,
          cx: cseId,
          q: q,
          searchType: "image",
          num: desired,
          filter: "0",
        },
        timeout: 10000,
      })
    );

    const items = Array.isArray(data?.items) ? data.items : [];
    const urls = items.map((i) => i?.link).filter(Boolean);
    const unique = getUniqueUrls(urls);

    if (unique.length > 0) {
      const total_cost = 8;
      usertoken.available_tokens -= total_cost;
      await usertoken.save();
    } else if (unique.length === 0) {
      const total_cost = 2;
      usertoken.available_tokens -= total_cost;
      await usertoken.save();
    }
    console.log(unique);
    return res.json({ success: true, data: unique });
  } catch (error) {
    const status = error?.response?.status || 500;
    let msg = "An unexpected error occurred.";
    if (status === 429) {
      msg = "Rate limit exceeded. Please try again later or contact support.";
      console.error(`Rate limit exhausted for query: ${req.query.q}.`);
    } else if (status >= 500) {
      msg = "Server error. Please try again later.";
    }
    console.error(
      "Google image search error:",
      status,
      error?.message,
      error?.response?.data
    );
    return res.status(status).json({ success: false, error: msg, data: [] });
  }
}

module.exports = { getImages };
