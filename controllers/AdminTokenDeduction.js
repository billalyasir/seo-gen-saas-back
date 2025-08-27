// controllers/tokenDedux.controller.js
const TokenDedux = require("../models/AdminTokenDeduction");

// helpers
const ok = (res, data, status = 200) =>
  res.status(status).json({ ok: true, data });
const fail = (res, message = "Something went wrong", status = 500, details) =>
  res
    .status(status)
    .json({ ok: false, message, ...(details ? { details } : {}) });

// CREATE (POST /admin/token-dedux)
exports.createTokenDedux = async (req, res) => {
  try {
    const { per_image_request, per_image, per_seo_input, per_seo_output } =
      req.body;
    //check if any token dedux system created then we dont need any other
    const findTokenDedux = await TokenDedux.find();
    if (findTokenDedux.length > 0) {
      return fail(res, `Token Manage Table Already Existed.`, 400);
    }
    // basic validation
    for (const [k, v] of Object.entries({
      per_image_request,
      per_image,
      per_seo_input,
      per_seo_output,
    })) {
      if (v === undefined || v === null || Number.isNaN(Number(v))) {
        return fail(res, `Field "${k}" is required and must be a number.`, 400);
      }
      if (Number(v) < 0) return fail(res, `Field "${k}" must be >= 0.`, 400);
    }

    const created = await TokenDedux.create({
      per_image_request: Number(per_image_request),
      per_image: Number(per_image),
      per_seo_input: Number(per_seo_input),
      per_seo_output: Number(per_seo_output),
    });

    return ok(res, created, 201);
  } catch (err) {
    return fail(res, "Failed to create TokenDedux", 500, err.message);
  }
};

// UPDATE (PATCH /admin/token-dedux/:id) — partial
exports.updateTokenDedux = async (req, res) => {
  try {
    const { id } = req.params;

    const allowed = [
      "per_image_request",
      "per_image",
      "per_seo_input",
      "per_seo_output",
    ];
    const updates = {};

    for (const key of allowed) {
      if (key in req.body) {
        const n = Number(req.body[key]);
        if (Number.isNaN(n))
          return fail(res, `Field "${key}" must be a number.`, 400);
        if (n < 0) return fail(res, `Field "${key}" must be >= 0.`, 400);
        updates[key] = n;
      }
    }

    if (!Object.keys(updates).length)
      return fail(res, "No valid fields provided.", 400);

    const updated = await TokenDedux.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) return fail(res, "TokenDedux not found", 404);
    return ok(res, updated);
  } catch (err) {
    return fail(res, "Failed to update TokenDedux", 500, err.message);
  }
};
