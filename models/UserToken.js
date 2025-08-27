const mongoose = require("mongoose");

const tokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    available_tokens: {
      type: Number,
      required: true,
      default: 0,
    },
    total_amout_spent_from_the_first: {
      type: Number,
      required: true,
      default: 0,
    },
    total_tokens_from_the_first: {
      type: Number,
      required: true,
      default: 0,
    },
    total_token_used_from_the_first: {
      type: Number,
      required: true,
      default: 0,
    },
    expiration: {
      type: Number,
    },
  },
  { timestamps: true }
);

const UserToken = mongoose.model("UserToken", tokenSchema);
module.exports = UserToken;
