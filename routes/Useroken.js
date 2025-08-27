// routes/tokenRoutes.js
const express = require("express");
const router = express.Router();

// Auth middleware that sets req.user (adjust to your project)
const { protect } = require("../middleware/auth");

// IMPORTANT: point to the correct controller file name
const ctrl = require("../controllers/UserToken");

// If you have role middlewares, uncomment and use them as needed:
// const requireAuth = require("../middleware/requireAuth");
// const isAdmin = require("../middleware/isAdmin");
// const isAdminOrOwner = require("../middleware/isAdminOrOwner");

// ----- User routes (require a logged-in user) -----
router.get("/me/list", protect, ctrl.getMyTokens);
router.post("/increment", protect, ctrl.incrementTokens);
router.post("/consume", protect, ctrl.consumeTokens);

// ----- Admin/management routes -----
// Order matters: specific routes before parameterized ones

// Set/extend expiration for a token doc
router.patch("/:id/expiration", /* requireAuth, isAdmin, */ ctrl.setExpiration);

// CRUD over token docs
router.get("/", protect, ctrl.getAllTokens);
router.post("/", /* requireAuth, isAdmin, */ ctrl.createToken);
router.get("/:id", /* requireAuth, isAdminOrOwner, */ ctrl.getTokenById);
router.patch("/:id", /* requireAuth, isAdmin, */ ctrl.updateToken);
router.delete("/:id", /* requireAuth, isAdmin, */ ctrl.deleteToken);

module.exports = router;
