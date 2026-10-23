import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import { imageUpload } from "../../common/middlewares/imageUpload.middleware.js";
import {
  getAllCompanies,
  getCompanyBySlug,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  uploadCompanyLogo,
} from "./company.controller.js";
import { createCompanySchema, updateCompanySchema } from "./company.schema.js";

const router = Router();

// Flexible upload middleware accepting file under "logo" or "file" field name
const uploadLogoMiddleware = (req, res, next) => {
  imageUpload.single("logo")(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) {
      return imageUpload.single("file")(req, res, (err2) => {
        if (err2) return next(err2);
        next();
      });
    }
    next();
  });
};

router.get("/", authMiddleware, getAllCompanies);
router.get("/slug/:slug", authMiddleware, getCompanyBySlug);
router.get("/:id", authMiddleware, getCompanyById);

// Admin-only mutation routes
router.post(
  "/upload-logo",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  uploadLogoMiddleware,
  uploadCompanyLogo
);

router.post(
  "/",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  validate(createCompanySchema),
  createCompany
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  validate(updateCompanySchema),
  updateCompany
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  deleteCompany
);

export default router;
