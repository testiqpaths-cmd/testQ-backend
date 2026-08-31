import Razorpay from "razorpay";
import env from "../../../config/env.js";

// Constructing eagerly at module load time meant a missing/unconfigured
// Razorpay credential crashed the ENTIRE server on boot (Razorpay's own
// constructor throws synchronously if key_id is missing), taking down
// everything else — auth, exams, cheating detection — not just payments.
// Deferring construction to first real use means a misconfigured payment
// integration only breaks payment endpoints, which already catch and
// forward errors via next(error) instead of crashing the process.
let client = null;

export function getRazorpayClient() {
  if (!client) {
    if (!env.RAZORPAY_KEY_ID) {
      throw new Error("Razorpay is not configured: RAZORPAY_ID env var is missing.");
    }
    client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
}
