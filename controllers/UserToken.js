// controllers/tokenController.js

/**
 * NOTE ABOUT YOUR SCHEMA:
 * In your model, these two fields have a typo and will throw:
 *   total_tokens_from_the_first: { type: Number, required },                  // <-- should be required: true
 *   total_token_used_from_the_first: { type: Number, required },              // <-- should be required: true
 * Make sure your model file fixes those (required: true) before using these controllers.
 */

const mongoose = require("mongoose");
const UserToken = require("../models/UserToken");

// Utility: consistent error response
const sendError = (res, status, message, details) =>
  res
    .status(status)
    .json({ success: false, message, ...(details && { details }) });

// Utility: pick only allowed fields from a source object

const pick = (src, fields) => {
  const out = {};
  fields.forEach((f) => {
    if (src[f] !== undefined) out[f] = src[f];
  });
  return out;
};

// Utility: basic pagination & sorting
const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(
    Math.max(parseInt(req.query.limit || "20", 10), 1),
    100
  );
  const skip = (page - 1) * limit;
  let sort = { createdAt: -1 };
  if (req.query.sort) {
    // e.g. ?sort=available_tokens:desc,expiration:asc
    sort = {};
    req.query.sort.split(",").forEach((pair) => {
      const [key, dir] = pair.split(":");
      if (key) sort[key] = (dir || "asc").toLowerCase() === "desc" ? -1 : 1;
    });
  }
  return { page, limit, skip, sort };
};

/**
 * Create a token document
 * Body: { available_tokens, total_amout_spent_from_the_first, total_tokens_from_the_first, total_token_used_from_the_first, expiration }
 * Uses req.user.id if present; otherwise accepts body.user (admin/backoffice).
 */
exports.createToken = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.user;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return sendError(res, 400, "Valid user id is required.");
    }

    const payload = pick(req.body, [
      "available_tokens",
      "total_amout_spent_from_the_first",
      "total_tokens_from_the_first",
      "total_token_used_from_the_first",
      "expiration",
    ]);

    const token = await UserToken.create({ user: userId, ...payload });
    return res.status(201).json({ success: true, data: token });
  } catch (err) {
    return sendError(res, 500, "Failed to create token.", err.message);
  }
};

/**
 * Get all tokens (admin)
 * Query: page, limit, sort, user (filter by user id)
 */
exports.getAllTokens = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const tokens = await UserToken.findOne({ user: req.user.id }).lean(); // <-- await + lean
    return res.status(200).json(tokens);
  } catch (error) {
    return sendError(res, 500, "Failed to fetch token", error.message);
  }
};

/**
 * Get a single token by id (admin or owner)
 * Param: :id
 */
exports.getTokenById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid token id.");
    }
    const token = await UserToken.findById(id).populate(
      "user",
      "_id name email"
    );
    if (!token) return sendError(res, 404, "Token not found.");
    return res.json({ success: true, data: token });
  } catch (err) {
    return sendError(res, 500, "Failed to fetch token.", err.message);
  }
};

/**
 * Get tokens for the authenticated user
 */
exports.getMyTokens = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "Unauthorized.");
    const { page, limit, skip, sort } = getPagination(req);
    const [items, total] = await Promise.all([
      UserToken.find({ user: userId }).sort(sort).skip(skip).limit(limit),
      UserToken.countDocuments({ user: userId }),
    ]);
    return res.json({
      success: true,
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    return sendError(res, 500, "Failed to fetch your tokens.", err.message);
  }
};

/**
 * Update a token by id (partial update)
 * Param: :id
 * Body: any subset of allowed fields
 */
exports.updateToken = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid token id.");
    }

    const updates = pick(req.body, [
      "available_tokens",
      "total_amout_spent_from_the_first",
      "total_tokens_from_the_first",
      "total_token_used_from_the_first",
      "expiration",
    ]);

    if (!Object.keys(updates).length) {
      return sendError(res, 400, "No valid fields provided to update.");
    }

    const token = await UserToken.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!token) return sendError(res, 404, "Token not found.");
    return res.json({ success: true, data: token });
  } catch (err) {
    return sendError(res, 500, "Failed to update token.", err.message);
  }
};

/**
 * Delete a token by id
 * Param: :id
 */
exports.deleteToken = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid token id.");
    }
    const token = await UserToken.findByIdAndDelete(id);
    if (!token) return sendError(res, 404, "Token not found.");
    return res.json({ success: true, message: "Token deleted." });
  } catch (err) {
    return sendError(res, 500, "Failed to delete token.", err.message);
  }
};

/**
 * Increment (add) tokens for a user (and adjust totals/spend if provided)
 * Body: { amount, spent_delta, total_tokens_delta, used_delta }
 * - amount: how many to add to available_tokens (can be negative to subtract, but see consumeTokens below)
 * - spent_delta: optional number to add to total_amout_spent_from_the_first
 * - total_tokens_delta: optional number to add to total_tokens_from_the_first
 * - used_delta: optional number to add to total_token_used_from_the_first
 */
exports.incrementTokens = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.user;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return sendError(res, 400, "Valid user id is required.");
    }

    const {
      amount = 0,
      spent_delta = 0,
      total_tokens_delta = 0,
      used_delta = 0,
    } = req.body;

    const update = {
      $inc: {
        available_tokens: amount,
        total_amout_spent_from_the_first: spent_delta,
        total_tokens_from_the_first: total_tokens_delta,
        total_token_used_from_the_first: used_delta,
      },
    };

    // Ensure doc exists; upsert creates a baseline with zeros if missing
    const token = await UserToken.findOneAndUpdate({ user: userId }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    // Guard: available_tokens should not drop below 0
    if (token.available_tokens < 0) {
      // revert this change
      await UserToken.updateOne(
        { _id: token._id },
        {
          $inc: {
            available_tokens: -amount,
            total_amout_spent_from_the_first: -spent_delta,
            total_tokens_from_the_first: -total_tokens_delta,
            total_token_used_from_the_first: -used_delta,
          },
        }
      );
      return sendError(
        res,
        400,
        "Operation would result in negative available_tokens."
      );
    }

    return res.json({ success: true, data: token });
  } catch (err) {
    return sendError(res, 500, "Failed to increment tokens.", err.message);
  }
};

/**
 * Consume tokens for the authenticated user
 * Body: { amount }
 * Automatically increases total_token_used_from_the_first by the same amount.
 */
exports.consumeTokens = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.user;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return sendError(res, 400, "Valid user id is required.");
    }

    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendError(res, 400, "amount must be a positive number.");
    }

    // Atomic guard using findOneAndUpdate with conditional
    const token = await UserToken.findOneAndUpdate(
      { user: userId, available_tokens: { $gte: amount } },
      {
        $inc: {
          available_tokens: -amount,
          total_token_used_from_the_first: amount,
        },
      },
      { new: true }
    );

    if (!token) {
      return sendError(res, 400, "Not enough available tokens.");
    }

    return res.json({ success: true, data: token });
  } catch (err) {
    return sendError(res, 500, "Failed to consume tokens.", err.message);
  }
};

/**
 * Set/extend expiration for a token doc
 * Param: :id
 * Body: { expiration }  // store your epoch/ms or days remaining, matching your schema semantics
 */
exports.setExpiration = async (req, res) => {
  try {
    const { id } = req.params;
    const { expiration } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendError(res, 400, "Invalid token id.");
    if (
      expiration === undefined ||
      expiration === null ||
      Number.isNaN(Number(expiration))
    ) {
      return sendError(res, 400, "A numeric expiration value is required.");
    }
    const token = await UserToken.findByIdAndUpdate(
      id,
      { expiration: Number(expiration) },
      { new: true, runValidators: true }
    );
    if (!token) return sendError(res, 404, "Token not found.");
    return res.json({ success: true, data: token });
  } catch (err) {
    return sendError(res, 500, "Failed to set expiration.", err.message);
  }
};
