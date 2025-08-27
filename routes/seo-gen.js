const express = require("express");
const { generateSEO } = require("../controllers/seo-gen");
const router = express.Router();
const { protect } = require("../middleware/auth");
// POST /api/seo/generate
router.post("/generate", protect, generateSEO);

module.exports = router;
