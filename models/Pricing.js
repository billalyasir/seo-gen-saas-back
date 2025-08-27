const mongoose = require("mongoose");

const pricingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    short_description: {
      type: String,
      required: true,
      trim: true,
    },
    tokens: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    features: [{ type: String, trim: true }],
  },
  { timestamps: true, versionKey: false }
);

const Pricing = mongoose.model("Pricing", pricingSchema);
module.exports = Pricing;
