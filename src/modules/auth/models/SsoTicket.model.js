import mongoose from "mongoose";

// A one-time, short-lived opaque credential minted for handing a testQ
// session off to a separate app (currently the resume builder) across a
// browser redirect. Deliberately not the same shape as an access/refresh
// JWT — it carries no claims of its own, only a pointer to the user, and
// exists purely to be redeemed exactly once by that app's backend calling
// back into /auth/sso/verify. Mirrors exam-browser's launchToken pattern.
const ssoTicketSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true }, // crypto.randomBytes(32).toString("hex")
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL backstop for tickets that are minted but never redeemed (closed tab,
// abandoned redirect) — the normal path deletes the document explicitly on
// redemption via findOneAndDelete, so this index only cleans up the rest.
ssoTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("SsoTicket", ssoTicketSchema);
