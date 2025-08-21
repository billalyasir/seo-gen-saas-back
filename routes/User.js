// routes/authRoutes.js
const express = require("express");
const router = express.Router();

const {
  signup,
  login,
  logout,
  getProfile,
  sendVerificationEmail,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  changePassword,
} = require("../controllers/User");

const { protect, authorize, requireVerified } = require("../middleware/auth");

// Public
router.post("/signup", signup);
router.post("/login", login);
router.post("/password/forgot", requestPasswordReset);
router.post("/password/reset/:token", resetPassword);
router.get("/verify/:token", verifyEmail);
router.get("/verify", verifyEmail);

// Authenticated
router.post("/logout", protect, logout);
router.get("/me", protect, getProfile);
router.post("/password/change", protect, changePassword);

// Send verification email (either authenticated or with {email} body)
router.post("/verify/send", protect, sendVerificationEmail);
router.post("/verify/send/public", sendVerificationEmail);

// Example of protected & verified route
router.get("/secret", protect, requireVerified, (req, res) => {
  res.json({ ok: true, message: `Hello ${req.user.id}, email verified ✅` });
});

// Example of role-based route (only admins)
router.get("/admin/metrics", protect, authorize("admin"), (req, res) => {
  res.json({ ok: true, message: "Admin metrics here" });
});

module.exports = router;
