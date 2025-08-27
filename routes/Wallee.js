// routes/wallee.js
const express = require("express");
const router = express.Router();
const { Wallee } = require("wallee");
require("dotenv").config({});

const spaceId = Number(process.env.WALLEE_SPACE_ID);
const userId = Number(process.env.WALLEE_USER_ID);
const apiSecret = String(process.env.WALLEE_AUTH_KEY);
const frontendBaseUrl = String(process.env.FRONTEND_BASE_URL);

// Wallee SDK config
const cfg = {
  space_id: spaceId,
  user_id: userId,
  api_secret: apiSecret,
};

const transactionService = new Wallee.api.TransactionService(cfg);
const paymentPageService = new Wallee.api.TransactionPaymentPageService(cfg);

// --- replace this with your DB layer ---
/** @type {Map<number, {userId?: string, reference?: string, amount: number, currency: string, fulfilled: boolean}>} */
const orderStore = new Map();

/**
 * Utility: Treat these as success states for fulfillment logic.
 * (Adjust to your business rules if needed.)
 */
const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

/**
 * POST /api/payments/wallee/checkout
 * Body: { amount: number, currency?: "EUR", name?: string, sku?: string, reference?: string, userId?: string }
 * Returns: { paymentPageUrl, transactionId }
 */
router.post("/wallee/checkout", async (req, res) => {
  try {
    const {
      amount,
      currency = "EUR",
      name = "Token Pack",
      sku = "token-pack",
      reference,
      userId: buyerUserId, // optional: whoever is buying
    } = req.body;

    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: "amount is required" });
    }

    // Build line item
    const lineItem = new Wallee.model.LineItemCreate();
    lineItem.name = name;
    lineItem.uniqueId = `${sku}-${Date.now()}`;
    lineItem.sku = sku;
    lineItem.quantity = 1;
    lineItem.amountIncludingTax = Number(amount);
    lineItem.type = Wallee.model.LineItemType.PRODUCT;

    // Build transaction
    const tx = new Wallee.model.TransactionCreate();
    tx.lineItems = [lineItem];
    tx.currency = currency;
    tx.autoConfirmationEnabled = true;
    tx.merchantReference = reference ?? `order-${Date.now()}`;

    // Redirects after hosted checkout:
    tx.successUrl = `${frontendBaseUrl}/`; // recommend a dedicated page
    tx.failedUrl = `${frontendBaseUrl}/wallee/failure`;

    // Create transaction
    const created = await transactionService.create(spaceId, tx);
    const transactionId = Number(created.body.id);

    // Hosted payment page URL
    const urlRes = await paymentPageService.paymentPageUrl(
      spaceId,
      transactionId
    );
    const paymentPageUrl = urlRes.body;

    // Persist minimal order info (swap for DB)
    orderStore.set(transactionId, {
      userId: buyerUserId,
      reference: tx.merchantReference,
      amount: Number(amount),
      currency,
      fulfilled: false,
    });

    console.log("[Checkout] Created tx:", {
      transactionId,
      reference: tx.merchantReference,
      amount: Number(amount),
      currency,
    });

    return res.json({ paymentPageUrl, transactionId });
  } catch (err) {
    console.error("wallee checkout error:", err?.response?.text || err);
    return res.status(500).json({ error: "Failed to create payment session" });
  }
});

/**
 * GET /api/payments/wallee/status/:id
 * Quick status probe — good for dashboards/health checks.
 */
router.get("/wallee/status/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const readRes = await transactionService.read(spaceId, id);
    return res.json({
      id,
      state: readRes.body.state, // e.g. AUTHORIZED, COMPLETED, FAILED
    });
  } catch (err) {
    console.error("wallee status error:", err?.response?.text || err);
    return res.status(500).json({ error: "Could not read transaction" });
  }
});

/**
 * POST /api/payments/wallee/fulfill/:id
 * For your success page: verify the tx state on the server,
 * run your business logic ONCE, and respond to the client.
 */
router.post("/wallee/fulfill/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const readRes = await transactionService.read(spaceId, id);
    const state = readRes.body.state;

    if (SUCCESS_STATES.has(state)) {
      const order = orderStore.get(id) || { fulfilled: false };

      if (!order.fulfilled) {
        // --- YOUR SUCCESS LOGIC (idempotent!) ---
        // e.g., grant tokens/credits to order.userId, mark order paid in DB, send email, etc.
        // await db.orders.markPaid(id)
        // await grantTokens(order.userId, calcTokens(order.amount))
        // await sendReceiptEmail(...)
        order.fulfilled = true;
        orderStore.set(id, order);
        console.log(`✅ Fulfilled order for tx=${id} (state=${state})`);
      } else {
        console.log(`ℹ️ Order already fulfilled for tx=${id}`);
      }

      return res.json({ ok: true, state, alreadyFulfilled: order.fulfilled });
    }

    if (FAILURE_STATES.has(state)) {
      console.log(`❌ Payment failed for tx=${id} (state=${state})`);
      return res.status(400).json({ ok: false, state });
    }

    // Pending or interim states
    console.log(`⏳ Payment pending for tx=${id} (state=${state})`);
    return res.status(202).json({ ok: false, state });
  } catch (err) {
    console.error("wallee fulfill error:", err?.response?.text || err);
    return res
      .status(500)
      .json({ error: "Could not verify/fulfill transaction" });
  }
});

/**
 * POST /api/payments/wallee/webhook
 * Configure this URL in Wallee "Webhook Listener" (Entity: Transaction).
 * Wallee will POST whenever the transaction changes state.
 *
 * NOTE: If Wallee supports signatures on your account, verify them here.
 * Regardless, ALWAYS re-read the transaction by ID for authoritative state.
 */
router.post(
  "/wallee/webhook",

  async (req, res) => {
    try {
      // Common payloads include: { listenerEntityId, entityId, listenerEntityTechnicalName, ... }
      const { entityId } = req.body || {};
      if (!entityId) {
        console.warn("Wallee webhook: missing entityId");
        return res.status(400).end();
      }

      const txId = Number(entityId);
      const readRes = await transactionService.read(spaceId, txId);
      const state = readRes.body.state;

      if (SUCCESS_STATES.has(state)) {
        const order = orderStore.get(txId) || { fulfilled: false };

        if (!order.fulfilled) {
          // --- YOUR SUCCESS LOGIC (idempotent!) ---
          order.fulfilled = true;
          orderStore.set(txId, order);
          console.log(
            `✅ [Webhook] Fulfilled order for tx=${txId} (state=${state})`
          );
        } else {
          console.log(`ℹ️ [Webhook] Already fulfilled tx=${txId}`);
        }
      } else if (FAILURE_STATES.has(state)) {
        console.log(`❌ [Webhook] Payment failed tx=${txId} (state=${state})`);
        // optional: mark failed / notify / clean up holds, etc.
      } else {
        console.log(`ℹ️ [Webhook] tx=${txId} state=${state}`);
      }

      // ACK quickly so Wallee doesn't retry immediately
      return res.status(200).end();
    } catch (err) {
      console.error("wallee webhook error:", err?.response?.text || err);
      return res.status(500).end();
    }
  }
);

module.exports = router;
