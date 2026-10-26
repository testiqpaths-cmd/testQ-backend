import { BrevoClient } from "@getbrevo/brevo";
import nodemailer from "nodemailer";
import env from "./env.js";

// Initialize Brevo client if API key is provided
let brevoClient = null;
if (env.BREVO_API_KEY) {
  brevoClient = new BrevoClient({
    apiKey: env.BREVO_API_KEY,
  });
}

const senderEmail = env.BREVO_SENDER_EMAIL || env.BREVO_FROM_EMAIL || env.BREVO_REPLY_TO_EMAIL || env.SMTP_USER;
const senderName = env.BREVO_SENDER_NAME || "TestQ";

// Setup optional SMTP transport if configured
let smtpTransporter = null;
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
  smtpTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: env.SMTP_SECURE || false,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

const stripHtml = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export default async ({ to, subject, html, textContent }) => {
  // 1. If SMTP is configured, use nodemailer
  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to,
        subject,
        html,
        text: textContent || stripHtml(html),
      });
      console.log("Email sent successfully via SMTP! Message ID:", info.messageId);
      return info;
    } catch (err) {
      console.error("SMTP Email failed:", err);
      throw err;
    }
  }

  // 2. Otherwise use Brevo REST API
  if (!brevoClient) {
    throw new Error("No email service configured. Please set BREVO_API_KEY or SMTP credentials in .env");
  }

  if (!senderEmail) {
    throw new Error("BREVO_SENDER_EMAIL is not configured in .env");
  }

  try {
    const result = await brevoClient.transactionalEmails.sendTransacEmail({
      subject,
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      htmlContent: html,
      textContent: textContent || stripHtml(html),
      replyTo: { email: senderEmail, name: senderName },
    });
    console.log("Email sent successfully via Brevo! Message ID:", result.messageId);
    return result;
  } catch (error) {
    const rawMsg = error?.body?.message || error.message || "";
    if (rawMsg.includes("unrecognised IP address") || error?.statusCode === 401) {
      const detailedMsg = `Brevo blocked email: Server IP is not authorized in Brevo. Please add your IP to https://app.brevo.com/security/authorised_ips or disable IP restrictions in Brevo settings. (${rawMsg})`;
      console.error("\n❌ [BREVO_UNAUTHORIZED_IP]:", detailedMsg, "\n");
      const err = new Error(detailedMsg);
      err.code = "BREVO_UNAUTHORIZED_IP";
      throw err;
    }
    console.error("Email failed:", error);
    throw error;
  }
};
