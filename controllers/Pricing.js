// controllers/pricing.controller.js
const mongoose = require("mongoose");
const Pricing = require("../models/Pricing");

// Small helper for consistent error responses
const sendError = (res, code, message) => res.status(code).json({ message });

/**
 * CREATE
 * POST /api/pricings
 */
const createPricing = async (req, res) => {
  try {
    const pricing = await Pricing.create(req.body);
    return res.status(201).json(pricing);
  } catch (error) {
    if (error.name === "ValidationError") {
      return sendError(res, 400, error.message);
    }
    return sendError(res, 500, "Something went wrong");
  }
};

/**
 * READ (all)
 * GET /api/pricings
 * Simple array response, no pagination
 */
const getPricings = async (_req, res) => {
  try {
    const items = await Pricing.find();
    return res.status(200).json(items);
  } catch (_error) {
    return sendError(res, 500, "Something went wrong");
  }
};

/**
 * READ (single)
 * GET /api/pricings/:id
 */
const getPricingById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid pricing id");
    }

    const pricing = await Pricing.findById(id);
    if (!pricing) return sendError(res, 404, "Pricing not found");

    return res.status(200).json(pricing);
  } catch (_error) {
    return sendError(res, 500, "Something went wrong");
  }
};

/**
 * UPDATE (partial or full)
 * PATCH /api/pricings/:id
 * If you prefer full replacement semantics, switch to PUT and validate required fields.
 */
const updatePricing = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid pricing id");
    }

    const pricing = await Pricing.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!pricing) return sendError(res, 404, "Pricing not found");

    return res.status(200).json(pricing);
  } catch (error) {
    if (error.name === "ValidationError") {
      return sendError(res, 400, error.message);
    }
    return sendError(res, 500, "Something went wrong");
  }
};

/**
 * DELETE
 * DELETE /api/pricings/:id
 */
const deletePricing = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid pricing id");
    }

    const pricing = await Pricing.findByIdAndDelete(id);
    if (!pricing) return sendError(res, 404, "Pricing not found");

    return res.status(204).send(); // No content
  } catch (_error) {
    return sendError(res, 500, "Something went wrong");
  }
};

module.exports = {
  createPricing,
  getPricings,
  getPricingById,
  updatePricing,
  deletePricing,
};
