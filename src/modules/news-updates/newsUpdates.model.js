const mongoose = require("mongoose");

const newsUpdatesSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true },
    message: { type: String, trim: true, required: true },
    tag: { type: String, trim: true, default: "Update" },
    tagColor: { type: String, trim: true, default: "#1358DA" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
    createdByRole: { type: String, required: true },
    organizationId: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("NewsUpdate", newsUpdatesSchema);