import sendEmail from "../config/email.js";
import env from "../config/env.js";

const recipient = process.argv[2] || env.BREVO_SENDER_EMAIL;

if (!recipient) {
  console.error("❌ No recipient email specified and no default sender email found.");
  console.log("Usage: node src/scripts/testEmail.js your-email@example.com");
  process.exit(1);
}

console.log(`Sending test email to: ${recipient}...`);
console.log(`Email Provider: ${env.SMTP_HOST ? `SMTP (${env.SMTP_HOST}:${env.SMTP_PORT})` : "Brevo API"}`);
console.log(`Sender: "${env.BREVO_SENDER_NAME || 'TestQ'}" <${env.BREVO_SENDER_EMAIL || env.SMTP_USER}>`);

sendEmail({
  to: recipient,
  subject: "TestQ - Diagnostic Email Test",
  html: `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
      <h2 style="color: #2563eb;">TestQ Email Configuration Test</h2>
      <p>This is a verification email from your TestQ backend.</p>
      <p>If you are receiving this, your email delivery service (Brevo / SMTP) is working properly!</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #64748b;">Sent at: ${new Date().toISOString()}</p>
    </div>
  `,
  textContent: `TestQ Diagnostic Email Test\n\nIf you are receiving this, your email configuration is working properly!\nSent at: ${new Date().toISOString()}`,
})
  .then((res) => {
    console.log("✅ SUCCESS: Test email dispatched successfully!");
    console.log(res);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ FAILURE: Unable to send test email.");
    console.error(err.message);
    if (err.code === "BREVO_UNAUTHORIZED_IP") {
      console.log("\n👉 Action Required:");
      console.log("1. Go to https://app.brevo.com/security/authorised_ips");
      console.log("2. Authorize your server IP (or disable IP restrictions)");
    }
    process.exit(1);
  });
