import { ApiError } from "../exceptions/ApiError.js";
import { checkFeatureAccess } from "../../modules/subscription/services/subscription.service.js";

const COMPANY_WISE_FEATURE_KEY = "COMPANY_WISE_TEST";

const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

// Reads companyIds off either the request body (test creation) or the query
// string (question listing/preview) — whichever the route actually uses.
const extractCompanyIds = (req) => {
  const fromBody = toArray(req.body?.companyIds);
  if (fromBody.length) return fromBody;

  const fromQuery = req.query?.companyIds ?? req.query?.companyId;
  return String(fromQuery ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
};

// For an update (PUT /tests/:id), the request may leave companyIds
// untouched entirely (e.g. only changing subjectIds) while the test being
// edited already has companyIds set — that's still "using" company-wise
// filtering and must stay gated. Only an update that explicitly sends its
// own companyIds (including an explicit [] to clear them) overrides what
// the test already has. Requires `req.test` to already be loaded (i.e. this
// must run after loadTest).
const resolveFinalCompanyIds = (req) => {
  const bodyHasCompanyIds = Boolean(req.body) && Object.prototype.hasOwnProperty.call(req.body, "companyIds");
  if (bodyHasCompanyIds) return toArray(req.body.companyIds);
  return toArray(req.test?.companyIds);
};

/**
 * Company-wise filtering (Test.companyIds at creation/update, companyId on
 * the question listing/preview endpoint) is only restricted when it's
 * actually being used — a request whose resulting companyIds are empty
 * behaves exactly as before for every role, including FREE students.
 * Reuses checkFeatureAccess's existing plan/feature resolution (so
 * ORGANIZATION and org-affiliated STUDENT accounts stay unrestricted, same
 * as every other featureMiddleware-gated route) but reports 403 instead of
 * checkFeatureAccess's usual 402, per this feature's specific requirement —
 * existing featureMiddleware/2xx consumers elsewhere in the app are
 * completely untouched by this file.
 *
 * Pass { mergeWithExisting: true } on an update route (after loadTest) so an
 * update that doesn't mention companyIds is evaluated against the test's
 * existing companyIds instead of being treated as "no company filtering
 * requested". Omit it (the default) for creation, where there is no
 * existing resource to merge against.
 */
export const companyWiseFeatureMiddleware = ({ mergeWithExisting = false } = {}) => async (req, res, next) => {
  try {
    const companyIds = mergeWithExisting ? resolveFinalCompanyIds(req) : extractCompanyIds(req);
    if (!companyIds.length) return next();

    const userId = req.user?._id;
    if (!userId) throw new ApiError(401, "Unauthorized access. User not found.");

    try {
      await checkFeatureAccess(userId, COMPANY_WISE_FEATURE_KEY);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 402) {
        throw new ApiError(403, "Company-wise filtering is available only for Pro/Paid students.");
      }
      throw err;
    }

    next();
  } catch (err) {
    next(err);
  }
};
