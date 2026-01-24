import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import env from "../../../config/env.js";

// Create transporter
export const transporter = nodemailer.createTransport({
  host: env.MAIL_HOST,
  port: Number(env.MAIL_PORT),
  secure: false, // true only for 465
  auth: {
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
  },
  connectionTimeout: 10000, // ⬅️ add
  greetingTimeout: 10000,   // ⬅️ add
  socketTimeout: 10000,     // ⬅️ add
  tls: {
    rejectUnauthorized: false, // ⬅️ add
  },
});


// Render email template
const renderTemplate = (templateName, data) => {
  const filePath = path.join(
    process.cwd(),
    "src",
    "modules",
    "auth",
    "templates",
    `${templateName}.html`,
  );

  const source = fs.readFileSync(filePath, "utf-8");
  const compiled = handlebars.compile(source);
  return compiled(data);
};


export const sendVerifyEmail = async (user, otp) => {
  const email = user.email || user.to;
  if (!email) {
    console.error("sendVerifyEmail: recipient email is missing", user);
    throw new Error("User email is required to send verification email");
  }

  const html = renderTemplate("verify-email", {
    firstName: user.firstName || "User",
    otp,
    expiry: 5,
  });

  try {
    const info = await transporter.sendMail({
      from: env.MAIL_FROM,        // must match MAIL_USER
      to: email,
      subject: "Your OTP Code",
      html,
    });

    console.log("Verification email sent successfully:", info.messageId);
  } catch (err) {
    console.error("sendVerifyEmail failed:", err);
    throw new Error("Failed to send OTP email: " + err.message);
  }
};

