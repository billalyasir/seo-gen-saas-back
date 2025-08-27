const express = require("express");
const { protect } = require("../middleware/auth");
const { getFileCount } = require("../controllers/UserFileCount");
const router = express.Router();

router.get("/file-count", protect, getFileCount);

module.exports = router;
