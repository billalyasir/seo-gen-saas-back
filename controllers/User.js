// controllers/authController.js
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

/* ===========================
   Mailer (Brevo SMTP via your env keys)
   =========================== */
// FROM must be a verified Brevo sender, e.g. 'Your App <no-reply@yourdomain.com>' or just an email.
const FROM_EMAIL = process.env.FROM || process.env.MAIL_FROM;
if (!FROM_EMAIL) {
  console.warn(
    "[MAILER] FROM is not set. Set FROM='Your App <no-reply@yourdomain.com>' in .env"
  );
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g. smtp-relay.brevo.com
  port: Number(process.env.SMTP_PORT) || 587, // 587 or 465
  secure: process.env.SMTP_PORT === "465" || false, // true if 465
  auth: {
    user: process.env.SMTP_USER, // your Brevo SMTP user
    pass: process.env.SMTP_PASS, // your Brevo SMTP pass
  },
});

async function sendMail({ to, subject, html, text, replyTo }) {
  return transporter.sendMail({
    from: FROM_EMAIL,
    to,
    subject,
    html,
    text,
    replyTo,
  });
}

/* ===========================
   Helpers
   =========================== */
function sanitizeUser(userDoc) {
  const obj = userDoc.toObject ? userDoc.toObject() : userDoc;
  const {
    password,
    __v,
    verificationTokenHash,
    verificationTokenExpires,
    passwordResetTokenHash,
    passwordResetTokenExpires,
    ...rest
  } = obj;
  return rest;
}

function signJwt(user) {
  // Keep payload minimal; include role + password change timestamp
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role || "user",
      pca: user.passwordChangedAt?.getTime() || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
  );
}

function createHashedToken(ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + ttlMs);
  return { token, hash, expires };
}

function buildVerifyLink(rawToken) {
  return process.env.CLIENT_URL
    ? `${process.env.CLIENT_URL}/verify-email?token=${rawToken}`
    : `${process.env.APP_URL}/api/auth/verify/${rawToken}`;
}

// Reissue a new verification token iff current token is missing/expired.
// Returns { sent: boolean, reason: "reissued" | "still_valid" }
async function maybeReissueVerification(user) {
  const now = new Date();
  const missing = !user.verificationTokenHash || !user.verificationTokenExpires;
  const expired = !missing && user.verificationTokenExpires <= now;

  if (missing || expired) {
    const { token, hash, expires } = createHashedToken(24 * 60 * 60 * 1000); // 24h
    user.verificationTokenHash = hash;
    user.verificationTokenExpires = expires;
    await user.save();

    const link = buildVerifyLink(token);
    try {
      await sendMail({
        to: user.email,
        subject: "Verify your email",
        text: `Hi ${user.name}, verify your email here (valid 24h): ${link}`,
        html: `<p>Hi ${user.name},</p><p>Confirm your email (valid for <b>24 hours</b>):</p><p><a href="${link}">${link}</a></p>`,
      });
    } catch (mailErr) {
      console.error("VERIFY_MAIL_RESEND_ERROR:", mailErr);
    }
    return { sent: true, reason: "reissued" };
  }

  return { sent: false, reason: "still_valid" };
}

/* ===========================
   Core Auth
   =========================== */
const signup = async (req, res) => {
  try {
    const { name, email, password: rawPassword, role } = req.body;
    if (!name || !email || !rawPassword)
      return res
        .status(400)
        .json({ message: "Name, email, and password are required." });

    const lowerEmail = email.toLowerCase();
    const existing = await User.findOne({ email: lowerEmail });

    // If an account already exists
    if (existing) {
      // If it's verified, then it's truly in use
      if (existing.isVerified) {
        return res.status(409).json({ message: "Email already in use." });
      }

      // Not verified -> reissue only if token missing/expired, then tell user to check email
      const outcome = await maybeReissueVerification(existing);
      const baseMsg = "You already have an account pending verification.";
      if (outcome.sent) {
        return res.status(200).json({
          message: `${baseMsg} We've sent you a new verification link.`,
          user: sanitizeUser(existing),
        });
      }
      return res.status(200).json({
        message: `${baseMsg} Please check your email for the verification link.`,
        user: sanitizeUser(existing),
      });
    }

    // New account path
    const hashed = bcrypt.hashSync(rawPassword, 10);
    const user = await User.create({
      name,
      email: lowerEmail,
      password: hashed,
      role:
        role && ["user", "admin", "manager"].includes(role) ? role : undefined,
      isVerified: false,
    });

    // Create verification token (valid 24h), store only hash+expiry, send email
    const {
      token: verifyToken,
      hash,
      expires,
    } = createHashedToken(24 * 60 * 60 * 1000);
    user.verificationTokenHash = hash;
    user.verificationTokenExpires = expires;
    await user.save();

    const link = buildVerifyLink(verifyToken);
    try {
      await sendMail({
        to: user.email,
        subject: "Verify your email",
        text: `Hi ${user.name}, verify your email here (valid 24h): ${link}`,
        html: `<p>Hi ${user.name},</p><p>Confirm your email (valid for <b>24 hours</b>):</p><p><a href="${link}">${link}</a></p>`,
      });
    } catch (mailErr) {
      console.error("SIGNUP_VERIFY_MAIL_ERROR:", mailErr);
    }

    // Don't issue JWT yet; require verification first
    return res.status(201).json({
      message:
        "Account created. Please check your email to verify your account.",
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("SIGNUP_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

const login = async (req, res) => {
  try {
    const { email, password: rawPassword } = req.body;
    if (!email || !rawPassword)
      return res
        .status(400)
        .json({ message: "Email and password are required." });

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );
    if (!user)
      return res.status(401).json({ message: "Invalid email or password." });

    const ok = await bcrypt.compare(rawPassword, user.password);
    if (!ok)
      return res.status(401).json({ message: "Invalid email or password." });

    // If not verified: reissue+resend when expired/missing, else ask them to check email

    if (!user.isVerified) {
      const outcome = await maybeReissueVerification(user);
      if (outcome.sent) {
        return res.status(403).json({
          message:
            "Your email is not verified. We have sent you a new verification link.",
        });
      }
      return res.status(403).json({
        message:
          "Your email is not verified. Please check your inbox for the verification link.",
      });
    }

    const token = signJwt(user);
    return res.status(200).json({ user: sanitizeUser(user), token });
  } catch (err) {
    console.error("LOGIN_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

// JWT-only: client just discards its token
const logout = async (_req, res) => {
  try {
    return res
      .status(200)
      .json({ message: "Logged out (client-side token cleared)." });
  } catch (err) {
    console.error("LOGOUT_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

const getProfile = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found." });
    return res.status(200).json(sanitizeUser(user));
  } catch (err) {
    console.error("GET_PROFILE_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

/* ===========================
   Email Verification
   =========================== */
const sendVerificationEmail = async (req, res) => {
  try {
    let user;
    if (req.user?.id) {
      user = await User.findById(req.user.id);
    } else if (req.body?.email) {
      user = await User.findOne({ email: req.body.email.toLowerCase() });
    } else {
      return res
        .status(400)
        .json({ message: "Provide an email or be authenticated." });
    }
    if (!user) return res.status(404).json({ message: "User not found." });

    if (user.isVerified) {
      return res.status(409).json({ message: "Account is already verified." });
    }

    const outcome = await maybeReissueVerification(user); // will reissue only if expired/missing
    if (outcome.sent) {
      return res.status(200).json({ message: "Verification email sent." });
    }
    // still valid (we don't have the raw token to re-send the same link)
    return res.status(200).json({
      message:
        "A verification link was already sent recently. Please check your inbox.",
    });
  } catch (err) {
    console.error("SEND_VERIFY_EMAIL_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const raw = req.params.token || req.query.token;
    if (!raw) return res.status(400).json({ message: "Missing token." });

    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const user = await User.findOne({
      verificationTokenHash: hash,
      verificationTokenExpires: { $gt: new Date() },
    });
    if (!user)
      return res
        .status(400)
        .json({ message: "Token is invalid or has expired." });

    user.isVerified = true;
    user.verificationTokenHash = null;
    user.verificationTokenExpires = null;
    await user.save();

    try {
      await sendMail({
        to: user.email,
        subject: "Email verified successfully",
        text: `Hi ${user.name}, your email has been verified. Welcome!`,
        html: `<p>Hi ${user.name},</p><p>Your email has been verified. 🎉</p>`,
      });
    } catch (_) {}

    return res.status(200).json({ message: "Email verified successfully." });
  } catch (err) {
    console.error("VERIFY_EMAIL_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

/* ===========================
   Password Reset & Change
   =========================== */
const requestPasswordReset = async (req, res) => {
  try {
    const email = req.body?.email?.toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(500)
        .json({ message: "User Not Found, Please Sign Up." });
    }
    if (user) {
      const { token, hash, expires } = createHashedToken(60 * 60 * 1000); // 1h
      user.passwordResetTokenHash = hash;
      user.passwordResetTokenExpires = expires;
      await user.save();

      const link = process.env.CLIENT_URL
        ? `${process.env.CLIENT_URL}/reset-password?token=${token}`
        : `${process.env.APP_URL}/api/auth/password/reset/${token}`;

      await sendMail({
        to: user.email,
        subject: "Reset your password",
        text: `Hi ${user.name}, reset your password (valid 1h): ${link}`,
        html: `<p>Hi ${user.name},</p><p>Reset your password (valid for <b>1 hour</b>):</p><p><a href="${link}">${link}</a></p>`,
      });
    }
    return res
      .status(200)
      .json({ message: "If that email exists, we've sent a reset link." });
  } catch (err) {
    console.error("REQUEST_PW_RESET_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const token = req.params.token || req.query.token;
    const newPassword = req.body?.password;
    if (!token) return res.status(400).json({ message: "Missing token." });
    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetTokenHash: hash,
      passwordResetTokenExpires: { $gt: new Date() },
    }).select("+password");
    if (!user)
      return res
        .status(400)
        .json({ message: "Token is invalid or has expired." });

    user.password = bcrypt.hashSync(newPassword, 10);
    user.passwordChangedAt = new Date();
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpires = null;
    await user.save();

    try {
      await sendMail({
        to: user.email,
        subject: "Your password was changed",
        text: `Hi ${user.name}, your password has been changed. If this wasn't you, contact support immediately.`,
        html: `<p>Hi ${user.name},</p><p>Your password has been changed. If this wasn't you, contact support immediately.</p>`,
      });
    } catch (_) {}

    const newToken = signJwt(user); // optionally issue new token after reset
    return res
      .status(200)
      .json({ message: "Password has been reset.", token: newToken });
  } catch (err) {
    console.error("RESET_PW_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

const changePassword = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message:
          "Current and new passwords are required; new password must be 6+ chars.",
      });
    }

    const user = await User.findById(req.user.id).select("+password");
    if (!user) return res.status(404).json({ message: "User not found." });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok)
      return res
        .status(401)
        .json({ message: "Current password is incorrect." });

    user.password = bcrypt.hashSync(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();

    try {
      await sendMail({
        to: user.email,
        subject: "Password updated",
        text: `Hi ${user.name}, your password was updated.`,
        html: `<p>Hi ${user.name},</p><p>Your password was updated.</p>`,
      });
    } catch (_) {}

    const token = signJwt(user);
    return res.status(200).json({ message: "Password updated.", token });
  } catch (err) {
    console.error("CHANGE_PW_ERROR:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

module.exports = {
  // core auth
  signup,
  login,
  logout,
  getProfile,

  // email verification
  sendVerificationEmail,
  verifyEmail,

  // password reset/change
  requestPasswordReset,
  resetPassword,
  changePassword,
};
