// routes/tokenDedux.routes.js
const express = require("express");
const router = express.Router();
const {
  createTokenDedux,
  updateTokenDedux,
} = require("../controllers/AdminTokenDeduction");
const { isAdmin, protect } = require("../middleware/auth");

router.post("/admin/token-dedux", protect, isAdmin, createTokenDedux);
router.patch("/admin/token-dedux/:id", protect, isAdmin, updateTokenDedux);

module.exports = router;
