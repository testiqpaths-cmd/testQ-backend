import mongoose from "mongoose";

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    // Basic Info
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: false,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    firebaseUid: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["STUDENT", "ORGANIZATION", "IQPATH_ADMIN"],
      default: "STUDENT",
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"],
      default: "PENDING",
      index: true,
    },

    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },

    plan: {
      type: String,
      enum: ["FREE", "PAID"],
      default: "FREE",
    },

    address: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
      zipCode: { type: String, trim: true },
    },

    // Education Details
    education: {
      qualification: {
        type: String,
        trim: true,
      },

      stream: {
        type: String,
        trim: true,
      },

      passingYear: {
        type: Number,
        min: 1950,
        max: new Date().getFullYear() + 5,
      },

      college: {
        type: String,
        trim: true,
      },
    },

    // Email Verification
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerifiedAt: {
      type: Date,
      default: null,
    },

    emailOtp: {
      code: {
        type: Number,
        required: null,
      },
      expiresIn: {
        type: Number,
        required: null,
      },
      createdAt: {
        type: Date,
        default: null,
      },
    },

    // Soft Delete Fields
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lastLogin: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

// Only enforce uniqueness when value is present and non-empty.
userSchema.index(
  { firebaseUid: 1 },
  {
    unique: true,
    partialFilterExpression: {
      firebaseUid: { $exists: true, $type: "string", $ne: "" },
    },
  },
);

userSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone: { $exists: true, $type: "string", $ne: "" },
    },
  },
);

userSchema.pre(/^find/, function () {
  if (this.getOptions?.().includeDeleted === true) return;
  this.where({ isDeleted: { $ne: true } });
});

userSchema.pre(/^findOneAndUpdate/, function () {
  if (this.getOptions?.().includeDeleted === true) return;
  this.where({ isDeleted: { $ne: true } });
});

export default model("User", userSchema);
