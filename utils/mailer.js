const nodemailer = require("nodemailer");
const AppError = require("./app-error");

const getMailerConfig = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM_EMAIL) {
    throw new AppError(
      500,
      "Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM_EMAIL.",
    );
  }

  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_FROM_EMAIL,
  };
};

const sendGuardianInviteEmail = async ({ toEmail, toName, inviteCode, expiresAt }) => {
  const config = getMailerConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  const frontendBaseUrl = process.env.FRONTEND_APP_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const inviteLink = `${frontendBaseUrl.replace(/\/$/, "")}/guardian-accept?code=${encodeURIComponent(inviteCode)}`;
  const expiryLabel = new Date(expiresAt).toLocaleString();

  const subject = "Guardian Invite - Women Safety Platform";
  const text = [
    `Hello ${toName},`,
    "",
    "You have been invited as a guardian in the Women Safety Platform.",
    `Invite Code: ${inviteCode}`,
    `Invite Link: ${inviteLink}`,
    `Expires At: ${expiryLabel}`,
    "",
    "Use this invite code during guardian registration to get linked.",
  ].join("\n");

  const html = `
    <p>Hello <strong>${toName}</strong>,</p>
    <p>You have been invited as a guardian in the Women Safety Platform.</p>
    <p><strong>Invite Code:</strong> ${inviteCode}</p>
    <p><strong>Invite Link:</strong> <a href="${inviteLink}">${inviteLink}</a></p>
    <p><strong>Expires At:</strong> ${expiryLabel}</p>
    <p>Use this invite code during guardian registration to get linked.</p>
  `;

  await transporter.sendMail({
    from: config.from,
    to: toEmail,
    subject,
    text,
    html,
  });
};

module.exports = { sendGuardianInviteEmail };
