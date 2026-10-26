export const resetPasswordOtpTemplate = ({ firstName, email, otp, expiresInMinutes = 10 }) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TestQ - Password Reset OTP</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
        .card { background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background: linear-gradient(135deg, #2563eb, #4f46e5); color: #ffffff; padding: 32px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
        .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
        .content { padding: 32px 28px; }
        .greeting { font-size: 17px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
        .message { font-size: 15px; color: #475569; margin-bottom: 24px; }
        .otp-container { background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0; }
        .otp-label { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .otp-code { font-size: 36px; font-weight: 800; color: #2563eb; letter-spacing: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .expiry-note { font-size: 13px; color: #ef4444; font-weight: 600; margin-top: 8px; }
        .security-notice { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #1e40af; margin-top: 24px; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <h1>TestQ Portal</h1>
            <p>Online Assessment Platform</p>
        </div>
        <div class="content">
            <div class="greeting">Hello ${firstName || "User"},</div>
            <div class="message">
                We received a request to reset the password for your account associated with <strong>${email}</strong>. Please use the verification code below to set a new password:
            </div>
            
            <div class="otp-container">
                <div class="otp-label">One-Time Password (OTP)</div>
                <div class="otp-code">${otp}</div>
                <div class="expiry-note">Expires in ${expiresInMinutes} minutes</div>
            </div>

            <div class="security-notice">
                <strong>Security Alert:</strong> If you did not request a password reset, please ignore this email or make sure your account is secure. Never share this code with anyone.
            </div>
        </div>
        <div class="footer">
            &copy; ${new Date().getFullYear()} IQ Paths / TestQ. All rights reserved.
        </div>
    </div>
</body>
</html>
`;
