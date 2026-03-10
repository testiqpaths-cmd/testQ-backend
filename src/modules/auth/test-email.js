import { transporter } from "./services/email.service.js"; // adjust path if needed
import logger from "../../config/logger.js";

(async () => {
  try {
    const info = await transporter.sendMail({
      from: 'TestQ <snehasasthi@gmail.com>',
      to: 'snehasasthi@gmail.com', // your inbox
      subject: 'Test OTP Email',
      html: '<h1>Your OTP is: 123456</h1>',
    });

    logger.info(`Email sent successfully: ${info.messageId}`);
  } catch (err) {
    logger.error(`Email failed: ${err.message}`);
  }
})();
