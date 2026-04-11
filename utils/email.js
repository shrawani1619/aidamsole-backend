const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'AiDamsole CRM'}" <${process.env.FROM_EMAIL || 'noreply@aidamsole.com'}>`,
      to, subject, html, text
    });
    console.log(`📧 Email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('Email error:', err.message);
    return { success: false, error: err.message };
  }
};

const frontendBase = () => {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3000';
  return String(raw).split(',')[0].trim().replace(/\/+$/, '');
};

// Welcome email — tempPassword + optional link to set password (same flow as forgot-password)
const sendWelcomeEmail = (user, tempPassword, setupPasswordUrl) => {
  const loginUrl = `${frontendBase()}/login`;
  const setupBlock = setupPasswordUrl
    ? `
        <a href="${setupPasswordUrl}"
           style="display:inline-block;background:#0D1B8E;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0 8px;">
          Set your password (secure link) →
        </a>
        <p style="color:#666;font-size:13px;margin:8px 0 0;">This link expires in 1 hour. You can also log in with the temporary password below and change it in Profile → Security.</p>
      `
    : '';
  return sendEmail({
    to: user.email,
    subject: 'Welcome to AiDamsole CRM — Your Account is Ready',
    html: `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;">
      <div style="background:#0D1B8E;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;">AiDamsole CRM</h1>
        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">Your account is ready</p>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px;">
        <h2 style="color:#1a1a2e;">Hello ${user.name},</h2>
        <p style="color:#555;">Your AiDamsole CRM account has been created.</p>
        ${setupBlock}
        <p style="color:#555;margin-top:20px;">Login details:</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin:12px 0;">
          <p style="margin:4px 0;"><strong>Email:</strong> ${user.email}</p>
          <p style="margin:4px 0;"><strong>Temporary password:</strong> ${tempPassword}</p>
          <p style="margin:4px 0;"><strong>Role:</strong> ${user.role.replace(/_/g, ' ')}</p>
        </div>
        <p style="color:#D32F2F;font-size:13px;">⚠️ Change your password after first login if you use the temporary password.</p>
        <a href="${loginUrl}"
           style="display:inline-block;background:#fff;color:#0D1B8E;border:2px solid #0D1B8E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:12px;">
          Login to CRM →
        </a>
      </div>
    </div>
  `,
  });
};

const sendPasswordResetEmail = (user, resetUrl) => sendEmail({
  to: user.email,
  subject: 'Reset your AiDamsole CRM password',
  html: `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;">
      <div style="background:#0D1B8E;padding:24px;border-radius:12px 12px 12px 12px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Password reset</h1>
      </div>
      <div style="background:#f9f9f9;padding:28px;border-radius:12px;margin-top:16px;">
        <p style="color:#333;">Hi ${user.name},</p>
        <p style="color:#555;">We received a request to reset your password. Click the button below (valid for 1 hour):</p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#0D1B8E;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:20px 0;">
          Reset password →
        </a>
        <p style="color:#888;font-size:12px;">If you did not ask for this, you can ignore this email.</p>
      </div>
    </div>
  `,
});

// Invoice email template
const sendInvoiceEmail = (invoice, client) => sendEmail({
  to: client.email,
  subject: `Invoice ${invoice.invoiceNumber} from AiDamsole — ₹${invoice.total.toLocaleString('en-IN')}`,
  html: `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;">
      <div style="background:#0D1B8E;padding:24px;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:20px;">Invoice ${invoice.invoiceNumber}</h1>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px;">
        <p>Dear ${client.name},</p>
        <p>Please find your invoice details below.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#0D1B8E;color:#fff;">
            <th style="padding:10px;text-align:left;">Description</th>
            <th style="padding:10px;text-align:right;">Amount</th>
          </tr>
          ${invoice.lineItems.map(item => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px;">${item.description}</td>
              <td style="padding:10px;text-align:right;">₹${item.total.toLocaleString('en-IN')}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;background:#f0f0f0;">
            <td style="padding:10px;">Total (incl. GST)</td>
            <td style="padding:10px;text-align:right;">₹${invoice.total.toLocaleString('en-IN')}</td>
          </tr>
        </table>
        <p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}</p>
        <p style="color:#555;font-size:13px;">For queries, reply to this email or contact your Account Manager.</p>
      </div>
    </div>
  `
});

module.exports = { sendEmail, sendWelcomeEmail, sendPasswordResetEmail, sendInvoiceEmail };
