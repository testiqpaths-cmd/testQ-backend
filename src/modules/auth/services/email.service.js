import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import env from "../../../config/env.js";

// Create transporter
const transporter = nodemailer.createTransport({
  host: env.MAIL_HOST,
  port: Number(env.MAIL_PORT),
  secure: false,
  auth: {
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
  },
});

// Render email template
const renderTemplate = (templateName, data) => {
  const filePath = path.join(
    process.cwd(),
    "src/modules/auth/templates",
    `${templateName}.html`
  );

  const source = fs.readFileSync(filePath, "utf-8");
  const compiled = handlebars.compile(source);
  return compiled(data);
};

// Send verification email (OTP)
export const sendVerifyEmail = async (user, otp) => {
  // Accept email from user.email or user.to
  const email = user.email || user.to;
  const name = user.firstName || user.name || "User";

  if (!email) {
    console.error("sendVerifyEmail: recipient email is missing", user);
    throw new Error("User email is required to send verification email");
  }

  // Render template
  const html = renderTemplate("verify-email", {
    name,
    verifyLink: `Your OTP: ${otp}`,
    expiry: 5, // minutes
  });

  console.log("Sending email to:", email);

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject: "Your OTP Code",
    html,
  });

  console.log("Verification email sent successfully to:", email);
};
