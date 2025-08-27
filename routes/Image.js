// routes/images.routes.js
const express = require("express");
const router = express.Router();
const { getImages } = require("../controllers/Image");
const { protect } = require("../middleware/auth");
// GET /api/images?barcode=XXXXXXXX
router.get("/images", protect, getImages);

module.exports = router;
