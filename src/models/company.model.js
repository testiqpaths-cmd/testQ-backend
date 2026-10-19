import mongoose from "mongoose";

export const generateSlug = (name) => {
  if (!name) return "";
  return name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: { type: String },
    logo: { type: String, default: null },
    primaryColor: { type: String, default: null, trim: true },
    secondaryColor: { type: String, default: null, trim: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

companySchema.virtual("logoUrl")
  .get(function () {
    return this.logo;
  })
  .set(function (val) {
    this.logo = val;
  });

companySchema.pre("validate", function () {
  if (this.name && !this.slug) {
    this.slug = generateSlug(this.name);
  }
});

export default mongoose.models.Company || mongoose.model("Company", companySchema);