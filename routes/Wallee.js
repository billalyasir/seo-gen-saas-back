// routes/wallee.js
const express = require("express");
const router = express.Router();
const { Wallee } = require("wallee");
require("dotenv").config({});

// Ensure JSON parsing for this router (helpful if not set globally)
router.use(express.json({ limit: "1mb" }));

const spaceId = Number(process.env.WALLEE_SPACE_ID);
const userId = Number(process.env.WALLEE_USER_ID); // (kept for completeness; not used directly)
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

/** Success/Failure states you care about (adjust to your rules). */
const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

/** Small helper */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/payments/wallee/checkout
 * Body: { amount: number, currency?: "EUR", name?: string, sku?: string, reference?: string, userId?: string }
 * Returns: { paymentPageUrl, transactionId }
 *
 * NOTE: This *only* creates the transaction. The payment happens on Wallee.
 * Use /fulfill/:id or /wait/:id (below) or the webhook to find out success/fail.
 */
router.post("/wallee/checkout", async (req, res) => {
  try {
    const {
      amount,
      currency = "EUR",
      name = "Token Pack",
      sku = "token-pack",
      reference,
      userId: buyerUserId,
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
    // IMPORTANT: point success to a dedicated page your frontend can use to call /fulfill or /wait
    tx.successUrl = `${frontendBaseUrl}/wallee/success`;
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
 * Quick read of a transaction state.
 */
router.get("/wallee/status/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const readRes = await transactionService.read(spaceId, id);
    return res.json({
      id,
      state: readRes.body.state, // e.g., AUTHORIZED, COMPLETED, FAILED
    });
  } catch (err) {
    console.error("wallee status error:", err?.response?.text || err);
    return res.status(500).json({ error: "Could not read transaction" });
  }
});

/**
 * POST /api/payments/wallee/fulfill/:id
 * Verify the tx on server and run idempotent success logic ONCE.
 * Good for your success page to call immediately.
 */
router.post("/wallee/fulfill/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const readRes = await transactionService.read(spaceId, id);
    const state = readRes.body.state;

    if (SUCCESS_STATES.has(state)) {
      const order = orderStore.get(id) || { fulfilled: false };
      if (!order.fulfilled) {
        // --- YOUR SUCCESS LOGIC (IDEMPOTENT) ---
        // e.g. grant tokens, mark order paid, email receipt, etc.
        order.fulfilled = true;
        orderStore.set(id, order);
        console.log(`✅ Fulfilled order for tx=${id} (state=${state})`);
      } else {
        console.log(`ℹ️ Order already fulfilled for tx=${id}`);
      }
      return res.json({ ok: true, state, alreadyFulfilled: true });
    }

    if (FAILURE_STATES.has(state)) {
      console.log(`❌ Payment failed for tx=${id} (state=${state})`);
      return res.status(400).json({ ok: false, state });
    }

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
 * POST /api/payments/wallee/wait/:id
 * OPTIONAL: Long-poll up to 60s and return success/fail/pending in one call.
 * Use this if you want a single request from the success page to block until paid.
 */
router.post("/wallee/wait/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deadline = Date.now() + 60_000; // 60s
    const intervalMs = 2000;

    while (Date.now() < deadline) {
      const readRes = await transactionService.read(spaceId, id);
      const state = readRes.body.state;

      if (SUCCESS_STATES.has(state)) {
        const order = orderStore.get(id) || { fulfilled: false };
        if (!order.fulfilled) {
          // --- YOUR SUCCESS LOGIC (IDEMPOTENT) ---
          order.fulfilled = true;
          orderStore.set(id, order);
          console.log(
            `✅ [Wait] Fulfilled order for tx=${id} (state=${state})`
          );
        }
        return res.json({ ok: true, state });
      }

      if (FAILURE_STATES.has(state)) {
        console.log(`❌ [Wait] Payment failed for tx=${id} (state=${state})`);
        return res.status(400).json({ ok: false, state });
      }

      await sleep(intervalMs);
    }

    // still pending after timeout
    return res.status(202).json({ ok: false, state: "PENDING", timeout: true });
  } catch (err) {
    console.error("wallee wait error:", err?.response?.text || err);
    return res.status(500).json({ error: "Could not wait on transaction" });
  }
});

/**
 * POST /api/payments/wallee/webhook
 * Configure this URL in Wallee (Entity: Transaction).
 * Wallee will POST whenever the transaction changes state.
 *
 * If your Wallee account supports signatures, verify them here,
 * then still re-read the transaction for authoritative state.
 */
router.post(
  "/wallee/webhook",
  express.json({ type: "*/*" }),
  async (req, res) => {
    try {
      // Common payload includes: { entityId, listenerEntityTechnicalName, ... }
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
          // --- YOUR SUCCESS LOGIC (IDEMPOTENT) ---
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
        // optional: mark failed / notify / cleanup, etc.
      } else {
        console.log(`ℹ️ [Webhook] tx=${txId} state=${state}`);
      }

      return res.status(200).end(); // ACK quickly so Wallee doesn't retry
    } catch (err) {
      console.error("wallee webhook error:", err?.response?.text || err);
      return res.status(500).end();
    }
  }
);

module.exports = router;
