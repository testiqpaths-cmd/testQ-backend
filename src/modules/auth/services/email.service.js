import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import env from "../../../config/env.js";
import logger from "../../../config/logger.js";

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
    logger.error(`Recipient email missing for user: ${JSON.stringify(user)}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: env.MAIL_FROM,    // must match MAIL_USER
      to: email,
      subject: "Your OTP Code",
      html: `<p>Hello ${user.firstName || 'User'},</p><p>Your OTP is <b>${otp}</b> (expires in 5 minutes)</p>`,
    });

    logger.info(`Verification email sent successfully to ${email}`);
  } catch (err) {
    logger.error(`Failed to send OTP email: ${err.message}`);
    // Important: don't throw here to prevent 500 error
  }
};
