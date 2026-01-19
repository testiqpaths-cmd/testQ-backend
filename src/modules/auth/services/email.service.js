import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import env from "../../../config/env.js";

const transporter = nodemailer.createTransport({
  host: env.MAIL_HOST,
  port: env.MAIL_PORT,
  secure: false,
  auth: {
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
  },
});

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

export const sendVerifyEmail = async (user, token) => {
  const verifyLink = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  const html = renderTemplate("verify-email", {
    name: user.name,
    verifyLink,
    expiry: 15,
  });

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: user.email,      // ✅ dynamic user email
    subject: "Verify your email",
    html,
  });
};
