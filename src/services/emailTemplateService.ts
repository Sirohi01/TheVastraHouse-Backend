export type AuthEmailTemplate = {
  subject: string;
  text: string;
  html?: string;
};

export function buildEmailVerificationTemplate(token: string): AuthEmailTemplate {
  return {
    subject: "Verify your The Vastra House account",
    text: `Use this verification token to verify your account: ${token}`,
  };
}

export function buildPasswordResetTemplate(token: string): AuthEmailTemplate {
  return {
    subject: "Reset your The Vastra House password",
    text: `Use this password reset token within 30 minutes: ${token}`,
  };
}

export function buildOtpTemplate(code: string): AuthEmailTemplate {
  return {
    subject: "Your The Vastra House OTP",
    text: `Your OTP is ${code}. It expires in 10 minutes.`,
  };
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
