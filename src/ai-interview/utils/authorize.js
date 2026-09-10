import User from "../../models/user.model.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

/**
 * Who may view a given interview session:
 *  - the candidate who owns it
 *  - any IQPATH_ADMIN
 *  - an ORGANIZATION user whose org the candidate belongs to (read-only
 *    monitoring of their own students)
 *
 * Throws ApiError(403) otherwise. Shared by getSessionById /
 * interview-results.loadOwnedSession so the rule stays in one place.
 */
export async function assertCanViewSession(user, session) {
  if (!user || !user._id) throw new ApiError(401, "Unauthorized");

  if (session.userId.toString() === user._id.toString()) return;
  if (user.role === "IQPATH_ADMIN") return;

  if (user.role === "ORGANIZATION" && user.organizationId) {
    const owner = await User.findById(session.userId).select("organizationId").lean();
    if (owner?.organizationId && owner.organizationId.toString() === user.organizationId.toString()) {
      return;
    }
  }

  throw new ApiError(403, "You are not authorized to view this interview session.");
}
