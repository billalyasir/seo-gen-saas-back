// middleware/auth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Protect: verifies JWT from Authorization header and attaches req.user
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" "); // "Bearer <token>"
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.id) return res.status(401).json({ message: "Unauthorized" });

    // Load current user to confirm existence and password change invalidation
    const user = await User.findById(decoded.id).select(
      "_id role passwordChangedAt isVerified"
    );
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    // Invalidate tokens issued before last password change (iat is in seconds)
    const tokenIssuedAtMs = (decoded.iat || 0) * 1000;
    const pca = user.passwordChangedAt?.getTime?.() || 0;
    if (pca && tokenIssuedAtMs < pca) {
      return res
        .status(401)
        .json({ message: "Session expired. Please log in again." });
    }

    req.user = {
      id: user._id.toString(),
      role: user.role || "user",
      isVerified: !!user.isVerified,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// Optional gate: require verified email
function requireVerified(req, res, next) {
  if (!req.user?.isVerified) {
    return res.status(403).json({ message: "Email not verified." });
  }
  next();
}

// Authorize: restrict routes by role(s)
function authorize(...allowedRoles) {
  return (req, res, next) => {
    try {
      if (!req.user?.role)
        return res.status(401).json({ message: "Unauthorized" });
      if (!allowedRoles.length) return next(); // no roles specified -> open to any authenticated user
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      next();
    } catch (err) {
      return res.status(403).json({ message: "Forbidden" });
    }
  };
}

module.exports = { protect, authorize, requireVerified };
