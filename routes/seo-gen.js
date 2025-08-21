const express = require("express");
const { generateSEO } = require("../controllers/seo-gen");
const router = express.Router();

// POST /api/seo/generate
router.post("/generate", generateSEO);

module.exports = router;
