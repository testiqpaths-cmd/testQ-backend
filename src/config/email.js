import { BrevoClient } from "@getbrevo/brevo";
import env from "./env.js";

// Never hardcode API keys in source. Load from environment instead.
const client = new BrevoClient({
    apiKey: env.BREVO_API_KEY,
});

const senderEmail = env.BREVO_SENDER_EMAIL || env.BREVO_FROM_EMAIL || env.BREVO_REPLY_TO_EMAIL;
const senderName = env.BREVO_SENDER_NAME || "TestQ";

const stripHtml = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export default async ({ to, subject, html, textContent }) => {
    try {
        if (!senderEmail) {
            throw new Error("BREVO_SENDER_EMAIL is not configured");
        }

        const result = await client.transactionalEmails.sendTransacEmail({
            subject: subject,
            sender: { name: senderName, email: senderEmail },
            to: [{ email: to }],
            htmlContent: html,
            textContent: textContent || stripHtml(html),
            replyTo: { email: senderEmail, name: senderName },
        });
        console.log("Email sent successfully!", result.messageId);
        return result;
    } catch (error) {
        console.error("Email failed:", error);
        throw error;
    }
}



