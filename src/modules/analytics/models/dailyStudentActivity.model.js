import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const dailyStudentActivitySchema = new Schema(
  {
    dateKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },

    sourceCategory: {
      type: String,
      enum: ["selfCreated", "organization", "admin", "iqRoom"],
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

dailyStudentActivitySchema.index(
  {
    dateKey: 1,
    studentId: 1,
    sourceCategory: 1,
    organizationId: 1,
  },
  {
    unique: true,
    name: "unique_daily_student_activity",
  }
);

dailyStudentActivitySchema.index(
  { dateKey: 1, organizationId: 1, sourceCategory: 1 },
  { name: "daily_activity_by_scope_and_source" }
);

const DailyStudentActivity =
  models.DailyStudentActivity ||
  model("DailyStudentActivity", dailyStudentActivitySchema);

export default DailyStudentActivity;
