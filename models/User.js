// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please use a valid email address."],
    },
    password: { type: String, required: true, minlength: 6, select: false },

    // Email verification (from earlier)
    isVerified: { type: Boolean, default: false },
    verificationTokenHash: { type: String, default: null },
    verificationTokenExpires: { type: Date, default: null },

    // NEW: password reset + token rotation
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetTokenExpires: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    isAdmin: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ verificationTokenExpires: 1 });
userSchema.index({ passwordResetTokenExpires: 1 });

function removeSensitive(_doc, ret) {
  delete ret.password;
  delete ret.__v;
  delete ret.verificationTokenHash;
  delete ret.verificationTokenExpires;
  delete ret.passwordResetTokenHash;
  delete ret.passwordResetTokenExpires;
  return ret;
}
userSchema.set("toJSON", { transform: removeSensitive });
userSchema.set("toObject", { transform: removeSensitive });

module.exports = mongoose.model("User", userSchema);
