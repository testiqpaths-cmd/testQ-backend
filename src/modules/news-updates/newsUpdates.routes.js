const express = require("express");
const controller = require("./newsUpdates.controller");

const router = express.Router();

const requireNewsManager = (req, res, next) => {
  const user = req.user || {};
  const role = String(user.role || user.userType || user.type || "").toUpperCase();

  if (
    user?.isAdmin ||
    user?.isSuperAdmin ||
    role === "IQPATH_ADMIN" ||
    role === "ADMIN" ||
    role === "ORGANIZATION" ||
    role === "ORG_ADMIN" ||
    role === "ORGANIZATION_ADMIN"
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Only organization admins and IQPath admins can manage news updates.",
  });
};

router.get("/", controller.listNewsUpdates);
router.post("/", requireNewsManager, controller.createNewsUpdate);
router.put("/:id", requireNewsManager, controller.updateNewsUpdate);
router.delete("/:id", requireNewsManager, controller.deleteNewsUpdate);

module.exports = router;