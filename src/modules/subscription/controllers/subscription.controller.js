import {
  getUserUsageDetails,
  upgradeUserPlan,
  createRazorpayOrder,
  verifyRazorpayPayment,
  processRazorpayWebhookEvent,
} from "../services/subscription.service.js";
import logger from "../../../config/logger.js";
import Role from "../models/Role.model.js";
import Feature from "../models/Feature.model.js";
import Plan from "../models/Plan.model.js";
import PlanFeature from "../models/PlanFeature.model.js";
import UserSubscription from "../models/UserSubscription.model.js";
import User from "../../../modules/auth/models/User.model.js";

// --- USER APIs ---

export const getMySubscriptionDetails = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const details = await getUserUsageDetails(userId);
    
    if (!details) {
      return res.status(404).json({ success: false, message: "No subscription found" });
    }

    res.json({ success: true, data: details });
  } catch (error) {
    next(error);
  }
};

export const upgradeMyPlan = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: "planId is required" });
    }

    // This is the self-service, unauthenticated-against-payment path — the
    // frontend only calls it for the $0 plan (createCheckoutOrder is the
    // paid-plan path, and it already rejects a $0 order the mirror-image
    // way). Without this check, calling this endpoint with ANY planId
    // silently downgrades/overwrites an active paid subscription with no
    // payment, no confirmation, and no trace connecting it to a purchase —
    // exactly what happened to a real user: a paid checkout correctly
    // activated Premium, then some later call to this same endpoint with
    // the Free plan's id silently reverted it, while leaving the original
    // payment's lastPaymentId/razorpayOrderId/razorpayPaymentId stamped on
    // the subscription untouched (upgradeUserPlan doesn't clear those),
    // which is exactly the fingerprint that traced this bug back here.
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }
    if (plan.price > 0) {
      return res.status(400).json({
        success: false,
        message: "Paid plans require checkout — use the upgrade-with-payment flow instead.",
      });
    }

    const newSub = await upgradeUserPlan(userId, planId);
    res.json({ success: true, message: "Plan upgraded successfully", data: newSub });
  } catch (error) {
    next(error);
  }
};

export const createCheckoutOrder = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: "planId is required" });
    }

    const order = await createRazorpayOrder(userId, planId);
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const verifyCheckoutPayment = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const sub = await verifyRazorpayPayment(userId, req.body);
    res.json({ success: true, message: "Payment verified, plan activated", data: sub });
  } catch (error) {
    next(error);
  }
};

export const handleRazorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const result = await processRazorpayWebhookEvent(req.rawBody, signature);
    logger.info(`Razorpay webhook processed: ${JSON.stringify(result)}`);
    res.status(200).json({ success: true });
  } catch (error) {
    // Signature failures are the only case worth a non-2xx — Razorpay
    // retries non-2xx responses with backoff, and retrying a permanently
    // invalid signature is just noise. Everything else (unknown order,
    // unhandled event type) is logged and still acknowledged with 200 so
    // Razorpay doesn't keep hammering this endpoint for it.
    if (error?.statusCode === 400) {
      logger.warn(`Razorpay webhook rejected: ${error.message}`);
      return res.status(400).json({ success: false, message: error.message });
    }
    logger.error(`Razorpay webhook error: ${error.message}`);
    res.status(200).json({ success: false, message: "Acknowledged with an internal error" });
  }
};

export const assignUserPlanController = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { planId } = req.body;
    
    if (!planId) {
      return res.status(400).json({ success: false, message: "planId is required" });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "Target user not found" });
    }

    // Role-based validations
    if (req.user.role === "ORGANIZATION") {
      if (targetUser.organizationId?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "You can only manage plans for students in your organization." });
      }
      
      const targetPlan = await Plan.findById(planId).populate("roleId");
      if (!targetPlan || targetPlan.roleId.name !== "STUDENT") {
        return res.status(403).json({ success: false, message: "Organizations can only assign STUDENT plans." });
      }
    }

    const newSub = await upgradeUserPlan(userId, planId);
    res.json({ success: true, message: "Plan assigned successfully", data: newSub });
  } catch (error) {
    next(error);
  }
};

export const getAvailablePlansForMyRole = async (req, res, next) => {
  try {
    const roleName = req.user.role.toUpperCase();
    const role = await Role.findOne({ name: roleName });
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    
    const plans = await Plan.find({ roleId: role._id, active: true });
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

export const getAllPlansPublic = async (req, res, next) => {
  try {
    const plans = await Plan.find({ active: true }).select("name _id roleId").populate("roleId", "name");
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

// --- ADMIN APIs ---

export const getRoles = async (req, res, next) => {
  try {
    const roles = await Role.find();
    res.json({ success: true, data: roles });
  } catch (error) {
    next(error);
  }
};

export const createRole = async (req, res, next) => {
  try {
    const role = await Role.create(req.body);
    res.status(201).json({ success: true, data: role });
  } catch (error) {
    next(error);
  }
};

export const updateRole = async (req, res, next) => {
  try {
    const role = await Role.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    res.json({ success: true, data: role });
  } catch (error) {
    next(error);
  }
};

export const deleteRole = async (req, res, next) => {
  try {
    const role = await Role.findByIdAndDelete(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    res.json({ success: true, message: "Role deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const getFeatures = async (req, res, next) => {
  try {
    const features = await Feature.find();
    res.json({ success: true, data: features });
  } catch (error) {
    next(error);
  }
};

export const createFeature = async (req, res, next) => {
  try {
    const feature = await Feature.create(req.body);
    res.status(201).json({ success: true, data: feature });
  } catch (error) {
    next(error);
  }
};

export const updateFeature = async (req, res, next) => {
  try {
    const feature = await Feature.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found" });
    res.json({ success: true, data: feature });
  } catch (error) {
    next(error);
  }
};

export const deleteFeature = async (req, res, next) => {
  try {
    const feature = await Feature.findByIdAndDelete(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found" });
    // Also delete any PlanFeatures referencing this feature
    await PlanFeature.deleteMany({ featureId: req.params.id });
    res.json({ success: true, message: "Feature deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const getPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find().populate("roleId");
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

export const createPlan = async (req, res, next) => {
  try {
    const plan = await Plan.create(req.body);
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

export const deletePlan = async (req, res, next) => {
  try {
    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    // Delete any PlanFeatures related to this plan
    await PlanFeature.deleteMany({ planId: req.params.id });
    // Also mark active UserSubscriptions as cancelled? We'll leave them for now.
    res.json({ success: true, message: "Plan deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const getPlanFeatures = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const planFeatures = await PlanFeature.find({ planId }).populate("featureId");
    res.json({ success: true, data: planFeatures });
  } catch (error) {
    next(error);
  }
};

export const updatePlanFeature = async (req, res, next) => {
  try {
    const { planId, featureId } = req.params;
    const { enabled, limit, resetType } = req.body;
    
    const pf = await PlanFeature.findOneAndUpdate(
      { planId, featureId },
      { enabled, limit, resetType },
      { new: true, upsert: true }
    );
    
    res.json({ success: true, message: "Plan feature updated", data: pf });
  } catch (error) {
    next(error);
  }
};
