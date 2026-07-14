export const loginTemplate = ({ firstName, email, password, loginUrl }) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
        .credentials { background: white; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; margin: 20px 0; font-family: monospace; }
        .btn { display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h2>Welcome to TestQ!</h2>
    </div>
    <div class="content">
        <p>Hi ${firstName || "Student"},</p>
        <p>Your account has been successfully created. You can now access your dashboard using the following credentials:</p>
        
        <div class="credentials">
            <strong>Email:</strong> ${email}<br>
            <strong>Password:</strong> ${password}
        </div>
        
        <p>Please log in and change your password as soon as possible.</p>
        
        <center>
            <a href="${loginUrl}" class="btn">Login to Your Account</a>
        </center>
        
        <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">If you did not request this account, please ignore this email.</p>
    </div>
</body>
</html>
`;