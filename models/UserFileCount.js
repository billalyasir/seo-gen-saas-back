const mongoose = require("mongoose");

const userFileCountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    count: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const FileCount = mongoose.model("FileCount", userFileCountSchema);

module.exports = FileCount;
