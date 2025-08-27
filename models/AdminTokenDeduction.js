// models/tokenDedux.model.js
const mongoose = require("mongoose");

const TokenDeduxSchema = new mongoose.Schema(
  {
    per_image_request: { type: Number, default: 0, min: 0 },
    per_image: { type: Number, default: 0, min: 0 },
    per_seo_input: { type: Number, default: 0, min: 0 },
    per_seo_output: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// collection: token_deduxes (by default)
module.exports = mongoose.model("TokenDedux", TokenDeduxSchema);
