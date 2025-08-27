// routes/pricing.routes.js
const express = require("express");
const router = express.Router();

const {
  createPricing,
  getPricings,
  getPricingById,
  updatePricing,
  deletePricing,
} = require("../controllers/Pricing");
const { protect, isAdmin } = require("../middleware/auth");

// CREATE
router.post("/pricing", protect, isAdmin, createPricing);

// READ (all)
router.get("/pricing", getPricings);

// READ (single by id)
router.get("/pricing/:id", getPricingById);

// UPDATE (by id) - patch for partial updates
router.patch("/pricing/:id", updatePricing);

// DELETE (by id)
router.delete("/pricing/:id", deletePricing);

module.exports = router;
