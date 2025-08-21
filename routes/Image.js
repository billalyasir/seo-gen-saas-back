// routes/images.routes.js
const express = require("express");
const router = express.Router();
const { getImages } = require("../controllers/Image");

// GET /api/images?barcode=XXXXXXXX
router.get("/images", getImages);

module.exports = router;
