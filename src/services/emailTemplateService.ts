import { env } from "../config/env.js";

export type AuthEmailTemplate = {
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ content: Buffer; filename: string; mimeType: string }>;
};

function frontendUrl(path: string) {
  return `${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}${path}`;
}

function actionEmail(input: { heading: string; body: string; cta: string; href: string; footer: string }) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fffaf1;color:#2c231d;border:1px solid #e5dac7">
      <div style="background:#8b1e2d;color:#fff;padding:24px">
        <h1 style="margin:0;font-size:24px;letter-spacing:1px">The Vastra House</h1>
      </div>
      <div style="padding:24px">
        <h2 style="margin-top:0;font-size:20px">${escapeHtml(input.heading)}</h2>
        <p>${escapeHtml(input.body)}</p>
        <a href="${input.href}" style="display:inline-block;background:#8b1e2d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">${escapeHtml(input.cta)}</a>
        <p style="margin-top:22px;color:#6b625a;font-size:13px">${escapeHtml(input.footer)}</p>
        <p style="color:#6b625a;font-size:12px;word-break:break-all">${input.href}</p>
      </div>
    </div>`;
}

export function buildEmailVerificationTemplate(token: string): AuthEmailTemplate {
  const href = frontendUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  return {
    html: actionEmail({
      body: "Confirm your email address to finish setting up your account.",
      cta: "Verify email",
      footer: "This link expires in 24 hours. If you did not create an account, ignore this email.",
      heading: "Verify your email",
      href,
    }),
    subject: "Verify your The Vastra House account",
    text: `Verify your The Vastra House account: ${href}

This link expires in 24 hours.`,
  };
}

export function buildPasswordResetTemplate(token: string): AuthEmailTemplate {
  const href = frontendUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  return {
    html: actionEmail({
      body: "We received a request to reset your password. Use the button below to choose a new one.",
      cta: "Reset password",
      footer: "This link expires in 30 minutes and can be used once. If you did not request it, you can ignore this email.",
      heading: "Reset your password",
      href,
    }),
    subject: "Reset your The Vastra House password",
    text: `Reset your password (valid for 30 minutes): ${href}`,
  };
}

export function buildOtpTemplate(code: string): AuthEmailTemplate {
  return {
    subject: "Your The Vastra House verification code",
    text: `Your verification code is ${code}. It expires in 10 minutes. Never share this code.`,
  };
}

export function buildTotpEnrolmentTemplate(code: string): AuthEmailTemplate {
  return {
    subject: "Confirm two-factor setup for your admin account",
    text: `Your admin two-factor setup code is ${code}. It expires in 10 minutes. If you did not just sign in, change your password immediately.`,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildOrderConfirmationTemplate(input: {
  balanceRemaining: string;
  customerName?: string;
  dueNow: string;
  orderNumber: string;
  trackUrl: string;
  total: string;
}): AuthEmailTemplate {
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,";

  return {
    subject: `Booking confirmed: ${input.orderNumber}`,
    text: `${greeting}

Your The Vastra House booking is confirmed.

Order / Track ID: ${input.orderNumber}
Full order value: ${input.total}
Paid / due now: ${input.dueNow}
Balance remaining: ${input.balanceRemaining}
Track your order: ${input.trackUrl}

Thank you for shopping with The Vastra House.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fffaf1;color:#2c231d;border:1px solid #e5dac7">
        <div style="background:#8b1e2d;color:#fff;padding:24px">
          <h1 style="margin:0;font-size:26px;letter-spacing:1px">The Vastra House</h1>
          <p style="margin:8px 0 0">Booking confirmed</p>
        </div>
        <div style="padding:24px">
          <p>${greeting}</p>
          <p>Your booking has been received and is now in our system.</p>
          <div style="background:#fff;border:1px solid #e5dac7;padding:16px;margin:18px 0">
            <p style="margin:0 0 8px"><strong>Track ID:</strong> ${input.orderNumber}</p>
            <p style="margin:0 0 8px"><strong>Full order value:</strong> ${input.total}</p>
            <p style="margin:0 0 8px"><strong>Paid / due now:</strong> ${input.dueNow}</p>
            <p style="margin:0"><strong>Balance remaining:</strong> ${input.balanceRemaining}</p>
          </div>
          <a href="${input.trackUrl}" style="display:inline-block;background:#8b1e2d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Track booking</a>
          <p style="margin-top:22px;color:#6b625a;font-size:14px">Keep this email for order tracking and support.</p>
        </div>
      </div>
    `,
  };
}

export function buildBalancePaymentReceivedTemplate(input: {
  amountPaid: string;
  customerName?: string;
  orderNumber: string;
  trackUrl: string;
}): AuthEmailTemplate {
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,";

  return {
    subject: `Balance payment received: ${input.orderNumber}`,
    text: `${greeting}

We have received your balance payment of ${input.amountPaid} for order ${input.orderNumber}. Your pre-order is now fully paid and will proceed toward production and dispatch.

Track your order: ${input.trackUrl}

Thank you for shopping with The Vastra House.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fffaf1;color:#2c231d;border:1px solid #e5dac7">
        <div style="background:#8b1e2d;color:#fff;padding:24px">
          <h1 style="margin:0;font-size:26px;letter-spacing:1px">The Vastra House</h1>
          <p style="margin:8px 0 0">Balance payment received</p>
        </div>
        <div style="padding:24px">
          <p>${greeting}</p>
          <p>We have received your balance payment. Your pre-order is now fully paid.</p>
          <div style="background:#fff;border:1px solid #e5dac7;padding:16px;margin:18px 0">
            <p style="margin:0 0 8px"><strong>Track ID:</strong> ${input.orderNumber}</p>
            <p style="margin:0"><strong>Balance paid:</strong> ${input.amountPaid}</p>
          </div>
          <a href="${input.trackUrl}" style="display:inline-block;background:#8b1e2d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Track booking</a>
          <p style="margin-top:22px;color:#6b625a;font-size:14px">Keep this email for order tracking and support.</p>
        </div>
      </div>
    `,
  };
}

export function buildStatusUpdateTemplate(input: {
  customerName?: string;
  note?: string;
  orderNumber: string;
  productName?: string;
  status: string;
  trackingNumber?: string;
  trackUrl: string;
}): AuthEmailTemplate {
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,";
  const product = input.productName ? `\nProduct: ${input.productName}` : "";
  const tracking = input.trackingNumber ? `\nTracking number: ${input.trackingNumber}` : "";
  const note = input.note ? `\nUpdate note: ${input.note}` : "";
  return {
    subject: `${input.status}: ${input.orderNumber}`,
    text: `${greeting}\n\nYour order status is now ${input.status}.\n\nOrder / Track ID: ${input.orderNumber}${product}${tracking}${note}\nTrack your order: ${input.trackUrl}\n\nThank you for shopping with The Vastra House.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fffaf1;color:#2c231d;border:1px solid #e5dac7"><div style="background:#8b1e2d;color:#fff;padding:24px"><h1 style="margin:0;font-size:26px">The Vastra House</h1><p style="margin:8px 0 0">${input.status}</p></div><div style="padding:24px"><p>${greeting}</p><p>Your order status is now <strong>${input.status}</strong>.</p><div style="background:#fff;border:1px solid #e5dac7;padding:16px;margin:18px 0"><p><strong>Track ID:</strong> ${input.orderNumber}</p>${input.productName ? `<p><strong>Product:</strong> ${input.productName}</p>` : ""}${input.trackingNumber ? `<p><strong>Tracking number:</strong> ${input.trackingNumber}</p>` : ""}${input.note ? `<p><strong>Update:</strong> ${input.note}</p>` : ""}</div><a href="${input.trackUrl}" style="display:inline-block;background:#8b1e2d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Track order</a></div></div>`,
  };
}
