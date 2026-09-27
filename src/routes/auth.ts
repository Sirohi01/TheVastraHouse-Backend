import crypto from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { AdminLoginHistory } from "../models/AdminLoginHistory.js";
import { AuthToken } from "../models/AuthToken.js";
import { Otp } from "../models/Otp.js";
import { User } from "../models/User.js";
import { emailIdentity, rateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { addMinutes, createOpaqueToken, hashOpaqueToken } from "../services/cryptoTokenService.js";
import {
  buildEmailVerificationTemplate,
  buildOtpTemplate,
  buildPasswordResetTemplate,
  buildTotpEnrolmentTemplate,
} from "../services/emailTemplateService.js";
import { signAccessToken } from "../services/jwtService.js";
import { mergeGuestCartIntoUserCart } from "../services/cartService.js";
import { enqueueNotification } from "../services/notificationDispatchService.js";
import { hashPassword, verifyPassword } from "../services/passwordService.js";
import { attributeReferral, getOrCreateReferralCode } from "../services/referralService.js";
import {
  familyIdForToken,
  issueRefreshToken,
  listActiveSessions,
  revokeAllUserSessions,
  revokeRefreshToken,
  revokeSessionFamily,
  rotateRefreshToken,
} from "../services/refreshTokenService.js";
import { getRuntimeBooleanSetting } from "../services/runtimeSettingsService.js";
import { createTotpSecret, verifyTotp } from "../services/totpService.js";
import { env, isProduction } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: "Password must contain at least one letter and one number",
  });
const loginPasswordSchema = z.string().min(1).max(128);
const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((email) => email.toLowerCase());
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{8,16}$/, "Enter a valid phone number");
const otpPurposeSchema = z.enum(["registration", "login", "password-reset", "sensitive-action"]);

const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 45;

export const authRouter = Router();

// Hash of a random secret, compared against for unknown emails so response timing does not
// reveal whether an account exists.
const timingDummyHash = hashPassword(crypto.randomUUID());

const strictAuthLimit = rateLimit({
  identify: emailIdentity,
  keyPrefix: "auth-strict",
  max: 10,
  windowMs: 15 * 60 * 1000,
});
const otpLimit = rateLimit({
  identify: (req) => (req.body as { target?: string } | undefined)?.target,
  keyPrefix: "otp",
  max: 5,
  windowMs: 10 * 60 * 1000,
});
const refreshLimit = rateLimit({ keyPrefix: "auth-refresh", max: 120, windowMs: 15 * 60 * 1000 });

/** Development shortcut only: never active in production, and opt-in elsewhere. */
function exposeDevTokens() {
  return !isProduction && env.EXPOSE_DEV_TOKENS;
}

authRouter.post(
  "/register",
  strictAuthLimit,
  validateRequest({
    body: z
      .object({
        email: emailSchema,
        password: passwordSchema,
        firstName: z.string().trim().min(1).max(80).optional().or(z.literal("").transform(() => undefined)),
        lastName: z.string().trim().min(1).max(80).optional().or(z.literal("").transform(() => undefined)),
        phone: phoneSchema.optional().or(z.literal("").transform(() => undefined)),
        referralCode: z.string().trim().min(3).max(40).optional().or(z.literal("").transform(() => undefined)),
        marketingConsent: z.boolean().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const existing = await User.findOne({ email: req.body.email }).select("_id").lean();

      if (existing) {
        throw new AppError("An account with this email already exists. Sign in instead.", 409);
      }

      const passwordHash = await hashPassword(req.body.password);
      const user = await User.create({
        email: req.body.email,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        marketingConsentAt: req.body.marketingConsent ? new Date() : undefined,
        notificationPreferences: req.body.marketingConsent
          ? { marketingEmail: true }
          : undefined,
        passwordHash,
        phone: req.body.phone,
        type: "customer",
      });

      if (req.body.referralCode) {
        await attributeReferral(req.body.referralCode, String(user._id));
      }

      const verificationToken = await sendVerificationEmail(user._id, user.email);

      res.status(201).json({
        user: serializeUser(user),
        verificationRequired: await isEmailVerificationRequired(),
        ...(exposeDevTokens() ? { devOnlyVerificationToken: verificationToken } : {}),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        next(new AppError("An account with this email already exists. Sign in instead.", 409));
        return;
      }
      next(error);
    }
  },
);

authRouter.post(
  "/verify-email",
  rateLimit({ keyPrefix: "verify-email", max: 20, windowMs: 15 * 60 * 1000 }),
  validateRequest({
    body: z.object({ token: z.string().min(20).max(200) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const authToken = await AuthToken.findOneAndUpdate(
        {
          tokenHash: hashOpaqueToken(req.body.token),
          type: "email-verification",
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        },
        { $set: { usedAt: new Date() } },
      );

      if (!authToken) {
        throw new AppError("This verification link is invalid or has expired", 400);
      }

      await User.updateOne(
        { _id: authToken.userId, emailVerifiedAt: { $exists: false } },
        { $set: { emailVerifiedAt: new Date() } },
      );

      res.json({ verified: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/resend-verification",
  strictAuthLimit,
  validateRequest({ body: z.object({ email: emailSchema }).strict() }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email, type: "customer" });
      let devToken: string | undefined;

      if (user && !user.emailVerifiedAt) {
        devToken = await sendVerificationEmail(user._id, user.email);
      }

      // Identical response whether or not the account exists (no account enumeration).
      res.json({
        message: "If the account needs verification, a new link has been sent.",
        ...(exposeDevTokens() && devToken ? { devOnlyVerificationToken: devToken } : {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/login",
  strictAuthLimit,
  validateRequest({
    body: z
      .object({
        email: emailSchema,
        password: loginPasswordSchema,
        totpToken: z.string().regex(/^\d{6}$/).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email }).select(
        "+passwordHash +totpSecret",
      );
      const ipAddress = req.ip;
      const userAgent = req.header("User-Agent");

      if (!user || user.anonymizedAt) {
        // Constant-ish work to avoid a timing oracle on unknown emails.
        await verifyPassword(req.body.password, await timingDummyHash);
        await recordAdminLogin(req.body.email, false, "unknown-user", ipAddress, userAgent);
        throw new AppError("Invalid email or password", 401);
      }

      if (user.status !== "active" || user.deactivatedAt) {
        await recordAdminLogin(user.email, false, "inactive", ipAddress, userAgent, user._id, user.type);
        throw new AppError("This account is inactive. Contact support for help.", 403);
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        await recordAdminLogin(user.email, false, "locked", ipAddress, userAgent, user._id, user.type);
        throw new AppError(
          "Too many failed attempts. Your account is locked for 15 minutes.",
          423,
        );
      }

      const passwordValid = await verifyPassword(req.body.password, user.passwordHash);

      if (!passwordValid) {
        user.failedLoginCount += 1;
        if (user.failedLoginCount >= 5) {
          user.lockedUntil = addMinutes(new Date(), 15);
          user.failedLoginCount = 0;
        }
        await user.save();
        await recordAdminLogin(user.email, false, "bad-password", ipAddress, userAgent, user._id, user.type);
        throw new AppError("Invalid email or password", 401);
      }

      if (user.type === "customer" && !user.emailVerifiedAt && (await isEmailVerificationRequired())) {
        res.status(403).json({
          error: {
            code: "EMAIL_NOT_VERIFIED",
            message: "Please verify your email address before signing in. We can resend the link.",
          },
        });
        return;
      }

      if (user.type === "admin" && (await isAdminTotpRequired())) {
        if (!user.totpEnabled || !user.totpSecret) {
          await sendTotpEnrolmentCode(user._id, user.email);
          await recordAdminLogin(user.email, false, "2fa-setup-required", ipAddress, userAgent, user._id, user.type);
          res.status(403).json({
            error: {
              code: "ADMIN_2FA_SETUP_REQUIRED",
              message:
                "Two-factor authentication is required. Enter the setup code we emailed you to continue.",
            },
          });
          return;
        }

        if (!req.body.totpToken) {
          res.status(401).json({
            error: { code: "ADMIN_TOTP_REQUIRED", message: "Enter the 6-digit code from your authenticator app." },
          });
          return;
        }

        if (!(await verifyTotp(req.body.totpToken, user.totpSecret))) {
          await recordAdminLogin(user.email, false, "bad-totp", ipAddress, userAgent, user._id, user.type);
          throw new AppError("The authenticator code is incorrect", 401);
        }
      }

      user.failedLoginCount = 0;
      user.lockedUntil = undefined;
      user.lastLoginAt = new Date();
      await user.save();

      const session = await issueSession(user, req);
      const guestSessionId = req.header("X-Guest-Session-Id");

      if (guestSessionId && user.type === "customer") {
        await mergeGuestCartIntoUserCart(guestSessionId, String(user._id));
      }

      await recordAdminLogin(user.email, true, undefined, ipAddress, userAgent, user._id, user.type);

      res.json({ ...session, user: serializeUser(user) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Step 1 of admin 2FA enrolment: password + emailed code reveals the TOTP secret. Requiring the
 * email code means a leaked password alone cannot enrol an attacker's authenticator.
 */
authRouter.post(
  "/admin/totp/setup",
  strictAuthLimit,
  validateRequest({
    body: z
      .object({ email: emailSchema, password: loginPasswordSchema, emailCode: z.string().regex(/^\d{6}$/) })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email, type: "admin" }).select(
        "+passwordHash +totpSecret",
      );

      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        throw new AppError("Invalid email or password", 401);
      }

      if (user.totpEnabled) {
        throw new AppError("Two-factor authentication is already enabled", 409);
      }

      const enrolment = await AuthToken.findOneAndUpdate(
        {
          expiresAt: { $gt: new Date() },
          tokenHash: hashOpaqueToken(`${String(user._id)}:${req.body.emailCode}`),
          type: "totp-enrolment",
          usedAt: { $exists: false },
          userId: user._id,
        },
        { $set: { usedAt: new Date() } },
      );

      if (!enrolment) {
        throw new AppError("The setup code is invalid or has expired", 400);
      }

      const setup = createTotpSecret(user.email);
      user.totpSecret = setup.secret;
      await user.save();

      res.json({ otpauthUrl: setup.otpauthUrl, totpSecret: setup.secret });
    } catch (error) {
      next(error);
    }
  },
);

/** Step 2: confirm the authenticator app works, which turns 2FA on. */
authRouter.post(
  "/admin/totp/enable",
  strictAuthLimit,
  validateRequest({
    body: z
      .object({ email: emailSchema, password: loginPasswordSchema, totpToken: z.string().regex(/^\d{6}$/) })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email, type: "admin" }).select(
        "+passwordHash +totpSecret",
      );

      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        throw new AppError("Invalid email or password", 401);
      }

      if (!user.totpSecret) {
        throw new AppError("Start two-factor setup first", 409);
      }

      if (!(await verifyTotp(req.body.totpToken, user.totpSecret))) {
        throw new AppError("The authenticator code is incorrect", 401);
      }

      user.totpEnabled = true;
      await user.save();

      res.json({ totpEnabled: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/admin/totp/resend",
  strictAuthLimit,
  validateRequest({ body: z.object({ email: emailSchema, password: loginPasswordSchema }).strict() }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email, type: "admin" }).select("+passwordHash");

      if (user && !user.totpEnabled && (await verifyPassword(req.body.password, user.passwordHash))) {
        await sendTotpEnrolmentCode(user._id, user.email);
      }

      res.json({ message: "If two-factor setup is pending, a new code has been emailed." });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/refresh",
  refreshLimit,
  validateRequest({
    body: z.object({ refreshToken: z.string().min(20).max(200) }).strict(),
  }),
  async (req, res, next) => {
    try {
      let rotated;
      try {
        rotated = await rotateRefreshToken(req.body.refreshToken, {
          userAgent: req.header("User-Agent"),
          ipAddress: req.ip,
        });
      } catch {
        throw new AppError("Your session has expired. Please sign in again.", 401);
      }
      const user = await User.findById(rotated.userId);

      if (!user || user.status !== "active" || user.deactivatedAt) {
        await revokeRefreshToken(rotated.refreshToken);
        throw new AppError("Your session has expired. Please sign in again.", 401);
      }

      res.json({
        accessToken: signAccessToken({
          sub: String(user._id),
          type: user.type,
          roleSlug: user.roleSlug,
          customerType: user.customerType,
        }),
        refreshToken: rotated.refreshToken,
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/logout",
  validateRequest({ body: z.object({ refreshToken: z.string().min(20).max(200) }).strict() }),
  async (req, res, next) => {
    try {
      await revokeRefreshToken(req.body.refreshToken);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post("/logout-all", requireAuth, async (req, res, next) => {
  try {
    await revokeAllUserSessions(req.user!.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const current =
      typeof req.query.current === "string" ? await familyIdForToken(req.query.current) : undefined;
    const sessions = await listActiveSessions(req.user!.id);
    res.json({
      sessions: sessions.map((session) => ({ ...session, current: session.sessionId === current })),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.delete(
  "/sessions/:sessionId",
  requireAuth,
  validateRequest({ params: z.object({ sessionId: z.string().min(8).max(80) }).strict() }),
  async (req, res, next) => {
    try {
      const revoked = await revokeSessionFamily(req.user!.id, String(req.params.sessionId));
      if (!revoked) throw new AppError("Session not found", 404);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/forgot-password",
  strictAuthLimit,
  validateRequest({
    body: z.object({ email: emailSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email });
      let devToken: string | undefined;

      if (user && !user.anonymizedAt && user.status === "active") {
        devToken = await createPasswordResetToken(user._id, user.email);
      }

      res.json({
        message: "If an account exists for that email, we have sent a password reset link.",
        ...(exposeDevTokens() && devToken ? { devOnlyResetToken: devToken } : {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/reset-password",
  strictAuthLimit,
  validateRequest({
    body: z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const authToken = await AuthToken.findOneAndUpdate(
        {
          tokenHash: hashOpaqueToken(req.body.token),
          type: "password-reset",
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        },
        { $set: { usedAt: new Date() } },
      );

      if (!authToken) {
        throw new AppError("This reset link is invalid or has expired. Request a new one.", 400);
      }

      await User.updateOne(
        { _id: authToken.userId },
        {
          $set: {
            // Resetting via an emailed link also proves ownership of the address.
            emailVerifiedAt: new Date(),
            failedLoginCount: 0,
            passwordChangedAt: new Date(),
            passwordHash: await hashPassword(req.body.password),
          },
          $unset: { lockedUntil: "" },
        },
      );
      // Invalidate every other outstanding reset link and sign the user out everywhere.
      await AuthToken.updateMany(
        { type: "password-reset", usedAt: { $exists: false }, userId: authToken.userId },
        { $set: { usedAt: new Date() } },
      );
      await revokeAllUserSessions(authToken.userId);

      res.json({ passwordReset: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/change-password",
  requireAuth,
  strictAuthLimit,
  validateRequest({
    body: z.object({ currentPassword: loginPasswordSchema, newPassword: passwordSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user!.id).select("+passwordHash");

      if (!user || !(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
        throw new AppError("Your current password is incorrect", 400);
      }

      user.passwordHash = await hashPassword(req.body.newPassword);
      user.passwordChangedAt = new Date();
      await user.save();
      await revokeAllUserSessions(user._id);
      const session = await issueSession(user, req);

      res.json({ ...session, passwordChanged: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/otp/request",
  otpLimit,
  validateRequest({
    body: z.object({ target: emailSchema, purpose: otpPurposeSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const target = req.body.target;
      const recent = (await Otp.findOne({
        consumedAt: { $exists: false },
        createdAt: { $gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000) },
        purpose: req.body.purpose,
        target,
      }).lean()) as { createdAt: Date } | null;

      if (recent) {
        const wait = Math.ceil(
          (recent.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000,
        );
        throw new AppError(`Please wait ${Math.max(1, wait)} seconds before requesting a new code`, 429);
      }

      const user = await User.findOne({ email: target }).select("_id type status").lean();
      let devCode: string | undefined;

      // Only send codes where they can be used; the response is identical either way.
      if (user || req.body.purpose === "registration") {
        const code = String(crypto.randomInt(100000, 1000000));
        await Otp.updateMany(
          { consumedAt: { $exists: false }, purpose: req.body.purpose, target },
          { $set: { consumedAt: new Date() } },
        );
        await Otp.create({
          codeHash: hashOpaqueToken(`${target}:${req.body.purpose}:${code}`),
          expiresAt: addMinutes(new Date(), OTP_TTL_MINUTES),
          purpose: req.body.purpose,
          target,
        });
        await enqueueNotification({
          channel: "email",
          eventType: "otp",
          fallback: buildOtpTemplate(code),
          to: target,
          variables: { code },
        });
        devCode = code;
      }

      res.status(201).json({
        expiresInSeconds: OTP_TTL_MINUTES * 60,
        otpSent: true,
        resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        ...(exposeDevTokens() && devCode ? { devOnlyOtpCode: devCode } : {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/otp/verify",
  otpLimit,
  validateRequest({
    body: z
      .object({
        target: emailSchema,
        purpose: otpPurposeSchema,
        code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const target = req.body.target;
      const otp = await Otp.findOne({
        target,
        purpose: req.body.purpose,
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .select("+codeHash");

      if (!otp) {
        throw new AppError("This code has expired. Request a new one.", 400);
      }

      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        otp.consumedAt = new Date();
        await otp.save();
        throw new AppError("Too many incorrect attempts. Request a new code.", 429);
      }

      const expected = hashOpaqueToken(`${target}:${req.body.purpose}:${req.body.code}`);

      if (!safeEqual(otp.codeHash, expected)) {
        otp.attempts += 1;
        if (otp.attempts >= OTP_MAX_ATTEMPTS) {
          otp.consumedAt = new Date();
        }
        await otp.save();
        const remaining = Math.max(0, OTP_MAX_ATTEMPTS - otp.attempts);
        throw new AppError(
          remaining ? `Incorrect code. ${remaining} attempt(s) left.` : "Too many incorrect attempts. Request a new code.",
          400,
        );
      }

      otp.consumedAt = new Date();
      await otp.save();
      res.json(await completeOtpPurpose(req, target, req.body.purpose));
    } catch (error) {
      next(error);
    }
  },
);

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user?.id);

    if (!user) {
      throw new AppError("User not found", 401);
    }

    res.json({ user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.patch(
  "/me",
  requireAuth,
  validateRequest({
    body: z
      .object({
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().max(80).optional(),
        phone: phoneSchema.optional().or(z.literal("")),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const update: Record<string, unknown> = {};
      if (req.body.firstName !== undefined) update.firstName = req.body.firstName;
      if (req.body.lastName !== undefined) update.lastName = req.body.lastName;
      if (req.body.phone !== undefined) update.phone = req.body.phone || undefined;
      const user = await User.findByIdAndUpdate(req.user!.id, { $set: update }, { new: true });
      if (!user) throw new AppError("User not found", 404);
      res.json({ user: serializeUser(user) });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.patch(
  "/me/preferences",
  requireAuth,
  validateRequest({
    body: z
      .object({
        whatsappOptIn: z.boolean().optional(),
        orderUpdatesEmail: z.boolean().optional(),
        orderUpdatesWhatsapp: z.boolean().optional(),
        marketingEmail: z.boolean().optional(),
        marketingWhatsapp: z.boolean().optional(),
        backInStock: z.boolean().optional(),
        reviewRequests: z.boolean().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const set: Record<string, unknown> = {};
      const body = req.body as Record<string, boolean | undefined>;

      for (const key of [
        "orderUpdatesEmail",
        "orderUpdatesWhatsapp",
        "marketingEmail",
        "marketingWhatsapp",
        "backInStock",
        "reviewRequests",
      ]) {
        if (body[key] !== undefined) {
          set[`notificationPreferences.${key}`] = body[key];
        }
      }

      const whatsapp = body.whatsappOptIn ?? body.orderUpdatesWhatsapp;
      if (whatsapp !== undefined) {
        set.whatsappOptIn = whatsapp;
        set["notificationPreferences.orderUpdatesWhatsapp"] = whatsapp;
      }

      if (body.marketingEmail === true || body.marketingWhatsapp === true) {
        set.marketingConsentAt = new Date();
      }

      const user = await User.findByIdAndUpdate(req.user!.id, { $set: set }, { new: true });
      if (!user) throw new AppError("User not found", 404);
      res.json({ user: serializeUser(user) });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.get("/me/referral", requireAuth, async (req, res, next) => {
  try {
    const code = await getOrCreateReferralCode(req.user!.id);
    res.json({
      code,
      link: `${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}/register?ref=${code}`,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/admin/login-history", requireAuth, async (req, res, next) => {
  try {
    if (req.user?.type !== "admin") {
      throw new AppError("Permission denied", 403);
    }

    const history = await AdminLoginHistory.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ history });
  } catch (error) {
    next(error);
  }
});

async function completeOtpPurpose(
  req: Request,
  target: string,
  purpose: z.infer<typeof otpPurposeSchema>,
) {
  const user = await User.findOne({ email: target });

  if (purpose === "registration") {
    if (user && !user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await user.save();
    }
    return { verified: true };
  }

  if (!user || user.status !== "active" || user.deactivatedAt || user.anonymizedAt) {
    throw new AppError("This code has expired. Request a new one.", 400);
  }

  if (purpose === "login") {
    if (user.type !== "customer") {
      throw new AppError("Staff accounts must sign in with a password and authenticator code", 403);
    }
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
    }
    user.lastLoginAt = new Date();
    await user.save();
    const session = await issueSession(user, req);
    const guestSessionId = req.header("X-Guest-Session-Id");
    if (guestSessionId) {
      await mergeGuestCartIntoUserCart(guestSessionId, String(user._id));
    }
    return { verified: true, ...session, user: serializeUser(user) };
  }

  if (purpose === "password-reset") {
    const resetToken = createOpaqueToken();
    await AuthToken.create({
      expiresAt: addMinutes(new Date(), 15),
      tokenHash: hashOpaqueToken(resetToken),
      type: "password-reset",
      userId: user._id,
    });
    return { resetToken, verified: true };
  }

  // sensitive-action: a short-lived step-up token for account deletion/data export etc.
  const stepUpToken = createOpaqueToken();
  await AuthToken.create({
    expiresAt: addMinutes(new Date(), 10),
    tokenHash: hashOpaqueToken(stepUpToken),
    type: "step-up",
    userId: user._id,
  });
  return { stepUpToken, verified: true };
}

async function issueSession(
  user: { _id: unknown; type: "customer" | "admin"; roleSlug?: string; customerType?: "retail" | "wholesale" },
  req: Request,
) {
  const accessToken = signAccessToken({
    sub: String(user._id),
    type: user.type,
    roleSlug: user.roleSlug,
    customerType: user.customerType,
  });
  const refreshToken = await issueRefreshToken({
    userId: user._id as Parameters<typeof issueRefreshToken>[0]["userId"],
    userAgent: req.header("User-Agent"),
    ipAddress: req.ip,
  });
  return { accessToken, refreshToken };
}

async function sendVerificationEmail(userId: unknown, email: string) {
  const verificationToken = createOpaqueToken();
  await AuthToken.updateMany(
    { type: "email-verification", usedAt: { $exists: false }, userId },
    { $set: { usedAt: new Date() } },
  );
  await AuthToken.create({
    expiresAt: addMinutes(new Date(), 24 * 60),
    tokenHash: hashOpaqueToken(verificationToken),
    type: "email-verification",
    userId,
  });
  await enqueueNotification({
    channel: "email",
    eventType: "email_verification",
    fallback: buildEmailVerificationTemplate(verificationToken),
    to: email,
    variables: { token: verificationToken },
  });
  return verificationToken;
}

async function createPasswordResetToken(userId: unknown, email: string) {
  const resetToken = createOpaqueToken();
  await AuthToken.create({
    expiresAt: addMinutes(new Date(), 30),
    tokenHash: hashOpaqueToken(resetToken),
    type: "password-reset",
    userId,
  });
  await enqueueNotification({
    channel: "email",
    eventType: "password_reset",
    fallback: buildPasswordResetTemplate(resetToken),
    to: email,
    variables: { token: resetToken },
  });
  return resetToken;
}

async function sendTotpEnrolmentCode(userId: unknown, email: string) {
  const code = String(crypto.randomInt(100000, 1000000));
  await AuthToken.updateMany(
    { type: "totp-enrolment", usedAt: { $exists: false }, userId },
    { $set: { usedAt: new Date() } },
  );
  await AuthToken.create({
    expiresAt: addMinutes(new Date(), 10),
    tokenHash: hashOpaqueToken(`${String(userId)}:${code}`),
    type: "totp-enrolment",
    userId,
  });
  await enqueueNotification({
    channel: "email",
    eventType: "admin_totp_enrolment",
    fallback: buildTotpEnrolmentTemplate(code),
    to: email,
    variables: { code },
  });
}

async function isEmailVerificationRequired() {
  return getRuntimeBooleanSetting("REQUIRE_EMAIL_VERIFICATION", env.REQUIRE_EMAIL_VERIFICATION);
}

async function isAdminTotpRequired() {
  return getRuntimeBooleanSetting("ADMIN_TOTP_REQUIRED", env.ADMIN_TOTP_REQUIRED);
}

function serializeUser(user: {
  _id: unknown;
  type: "customer" | "admin";
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  emailVerifiedAt?: Date;
  roleSlug?: string;
  customerType?: "retail" | "wholesale";
  whatsappOptIn?: boolean;
  notificationPreferences?: Record<string, unknown>;
  wholesaleStatus?: string;
  totpEnabled?: boolean;
  createdAt?: Date;
}) {
  const preferences = (user.notificationPreferences ?? {}) as Record<string, boolean | undefined>;
  return {
    id: String(user._id),
    type: user.type,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerifiedAt),
    roleSlug: user.roleSlug,
    customerType: user.customerType,
    wholesaleStatus: user.wholesaleStatus ?? "none",
    whatsappOptIn: user.whatsappOptIn ?? false,
    totpEnabled: user.type === "admin" ? Boolean(user.totpEnabled) : undefined,
    createdAt: user.createdAt,
    notificationPreferences: {
      backInStock: preferences.backInStock ?? true,
      marketingEmail: preferences.marketingEmail ?? false,
      marketingWhatsapp: preferences.marketingWhatsapp ?? false,
      orderUpdatesEmail: preferences.orderUpdatesEmail ?? true,
      orderUpdatesWhatsapp: preferences.orderUpdatesWhatsapp ?? user.whatsappOptIn ?? false,
      reviewRequests: preferences.reviewRequests ?? true,
    },
  };
}

async function recordAdminLogin(
  email: string,
  success: boolean,
  failureReason?: string,
  ipAddress?: string,
  userAgent?: string,
  userId?: unknown,
  userType?: "customer" | "admin",
): Promise<void> {
  if (userType === "customer") {
    return;
  }

  await AdminLoginHistory.create({
    email,
    success,
    failureReason,
    ipAddress,
    userAgent,
    userId,
  });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
