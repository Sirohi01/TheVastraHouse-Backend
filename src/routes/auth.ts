import { Router } from "express";
import { z } from "zod";
import { AdminLoginHistory } from "../models/AdminLoginHistory.js";
import { AuthToken } from "../models/AuthToken.js";
import { Otp } from "../models/Otp.js";
import { User } from "../models/User.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { addMinutes, createOpaqueToken, hashOpaqueToken } from "../services/cryptoTokenService.js";
import {
  buildEmailVerificationTemplate,
  buildOtpTemplate,
  buildPasswordResetTemplate,
} from "../services/emailTemplateService.js";
import { signAccessToken } from "../services/jwtService.js";
import { mergeGuestCartIntoUserCart } from "../services/cartService.js";
import { hashPassword, verifyPassword } from "../services/passwordService.js";
import { issueRefreshToken, rotateRefreshToken } from "../services/refreshTokenService.js";
import { createTotpSecret, verifyTotp } from "../services/totpService.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

const passwordSchema = z.string().min(8).max(128);

export const authRouter = Router();

const strictAuthLimit = rateLimit({ keyPrefix: "auth-strict", windowMs: 15 * 60 * 1000, max: 20 });
const otpLimit = rateLimit({ keyPrefix: "otp", windowMs: 10 * 60 * 1000, max: 5 });

authRouter.post(
  "/register",
  strictAuthLimit,
  validateRequest({
    body: z
      .object({
        email: z.string().email(),
        password: passwordSchema,
        firstName: z.string().min(1).max(80).optional(),
        lastName: z.string().min(1).max(80).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const passwordHash = await hashPassword(req.body.password);
      const user = await User.create({
        type: "customer",
        email: req.body.email,
        passwordHash,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
      });
      const verificationToken = createOpaqueToken();

      await AuthToken.create({
        userId: user._id,
        tokenHash: hashOpaqueToken(verificationToken),
        type: "email-verification",
        expiresAt: addMinutes(new Date(), 60),
      });
      const verificationEmail = buildEmailVerificationTemplate(verificationToken);

      res.status(201).json({
        user: serializeUser(user),
        devOnlyVerificationToken: verificationToken,
        devOnlyEmailPreview: verificationEmail,
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/verify-email",
  validateRequest({
    body: z.object({ token: z.string().min(20) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const tokenHash = hashOpaqueToken(req.body.token);
      const authToken = await AuthToken.findOne({
        tokenHash,
        type: "email-verification",
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      }).select("+tokenHash");

      if (!authToken) {
        throw new AppError("Verification token is invalid or expired", 400);
      }

      await User.updateOne({ _id: authToken.userId }, { $set: { emailVerifiedAt: new Date() } });
      authToken.usedAt = new Date();
      await authToken.save();

      res.json({ verified: true });
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
        email: z.string().email(),
        password: passwordSchema,
        totpToken: z.string().length(6).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email.toLowerCase() }).select(
        "+passwordHash +totpSecret",
      );
      const ipAddress = req.ip;
      const userAgent = req.header("User-Agent");

      if (!user) {
        await recordAdminLogin(req.body.email, false, "unknown-user", ipAddress, userAgent);
        throw new AppError("Invalid email or password", 401);
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        await recordAdminLogin(user.email, false, "locked", ipAddress, userAgent, user._id);
        throw new AppError("Account is temporarily locked", 423);
      }

      const passwordValid = await verifyPassword(req.body.password, user.passwordHash);

      if (!passwordValid) {
        user.failedLoginCount += 1;
        if (user.failedLoginCount >= 5) {
          user.lockedUntil = addMinutes(new Date(), 15);
        }
        await user.save();
        await recordAdminLogin(user.email, false, "bad-password", ipAddress, userAgent, user._id);
        throw new AppError("Invalid email or password", 401);
      }

      if (user.type === "admin" && env.ADMIN_TOTP_REQUIRED) {
        if (!user.totpEnabled || !user.totpSecret) {
          const setup = createTotpSecret(user.email);
          user.totpSecret = setup.secret;
          await user.save();
          res.status(403).json({
            error: "ADMIN_2FA_SETUP_REQUIRED",
            otpauthUrl: setup.otpauthUrl,
            totpSecret: setup.secret,
          });
          return;
        }

        if (!req.body.totpToken || !(await verifyTotp(req.body.totpToken, user.totpSecret))) {
          await recordAdminLogin(user.email, false, "bad-totp", ipAddress, userAgent, user._id);
          throw new AppError("TOTP code is required for admin login", 401);
        }
      }

      user.failedLoginCount = 0;
      user.lockedUntil = undefined;
      user.lastLoginAt = new Date();
      await user.save();

      const accessToken = signAccessToken({
        sub: String(user._id),
        type: user.type,
        roleSlug: user.roleSlug,
        customerType: user.customerType,
      });
      const refreshToken = await issueRefreshToken({
        userId: user._id,
        userAgent,
        ipAddress,
      });
      const guestSessionId = req.header("X-Guest-Session-Id");

      if (guestSessionId) {
        await mergeGuestCartIntoUserCart(guestSessionId, String(user._id));
      }

      await recordAdminLogin(
        user.email,
        true,
        undefined,
        ipAddress,
        userAgent,
        user._id,
        user.type,
      );

      res.json({
        accessToken,
        refreshToken,
        user: serializeUser(user),
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/admin/totp/enable",
  strictAuthLimit,
  validateRequest({
    body: z
      .object({
        email: z.string().email(),
        password: passwordSchema,
        totpToken: z.string().length(6),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({
        email: req.body.email.toLowerCase(),
        type: "admin",
      }).select("+passwordHash +totpSecret");

      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        throw new AppError("Invalid email or password", 401);
      }

      if (!user.totpSecret) {
        const setup = createTotpSecret(user.email);
        user.totpSecret = setup.secret;
        await user.save();
        res.status(409).json({
          error: "ADMIN_2FA_SETUP_REQUIRED",
          otpauthUrl: setup.otpauthUrl,
          totpSecret: setup.secret,
        });
        return;
      }

      if (!(await verifyTotp(req.body.totpToken, user.totpSecret))) {
        throw new AppError("TOTP code is invalid", 401);
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
  "/refresh",
  validateRequest({
    body: z.object({ refreshToken: z.string().min(20) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const rotated = await rotateRefreshToken(req.body.refreshToken, {
        userAgent: req.header("User-Agent"),
        ipAddress: req.ip,
      });
      const user = await User.findById(rotated.userId);

      if (!user) {
        throw new AppError("User not found", 401);
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
  "/forgot-password",
  strictAuthLimit,
  validateRequest({
    body: z.object({ email: z.string().email() }).strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email.toLowerCase() });

      if (user) {
        const resetToken = createOpaqueToken();
        const resetEmail = buildPasswordResetTemplate(resetToken);
        await AuthToken.create({
          userId: user._id,
          tokenHash: hashOpaqueToken(resetToken),
          type: "password-reset",
          expiresAt: addMinutes(new Date(), 30),
          metadata: resetEmail,
        });
      }

      res.json({
        message: "If an account exists, a password reset email has been prepared.",
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
    body: z.object({ token: z.string().min(20), password: passwordSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const authToken = await AuthToken.findOne({
        tokenHash: hashOpaqueToken(req.body.token),
        type: "password-reset",
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      }).select("+tokenHash");

      if (!authToken) {
        throw new AppError("Reset token is invalid or expired", 400);
      }

      await User.updateOne(
        { _id: authToken.userId },
        {
          $set: { passwordHash: await hashPassword(req.body.password), failedLoginCount: 0 },
          $unset: { lockedUntil: "" },
        },
      );
      authToken.usedAt = new Date();
      await authToken.save();

      res.json({ passwordReset: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/otp/request",
  otpLimit,
  validateRequest({
    body: z
      .object({
        target: z.string().min(3).max(254),
        purpose: z.enum(["registration", "login", "password-reset", "sensitive-action"]),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const otpEmail = buildOtpTemplate(code);
      await Otp.create({
        target: req.body.target,
        purpose: req.body.purpose,
        codeHash: hashOpaqueToken(code),
        expiresAt: addMinutes(new Date(), 10),
      });

      res
        .status(201)
        .json({ otpPrepared: true, devOnlyOtpCode: code, devOnlyEmailPreview: otpEmail });
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
        target: z.string().min(3).max(254),
        purpose: z.enum(["registration", "login", "password-reset", "sensitive-action"]),
        code: z.string().length(6),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const otp = await Otp.findOne({
        target: req.body.target.toLowerCase(),
        purpose: req.body.purpose,
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .select("+codeHash");

      if (!otp || otp.codeHash !== hashOpaqueToken(req.body.code)) {
        if (otp) {
          otp.attempts += 1;
          await otp.save();
        }
        throw new AppError("OTP is invalid or expired", 400);
      }

      otp.consumedAt = new Date();
      await otp.save();

      res.json({ verified: true });
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

function serializeUser(user: {
  _id: unknown;
  type: "customer" | "admin";
  email: string;
  firstName?: string;
  lastName?: string;
  emailVerifiedAt?: Date;
  roleSlug?: string;
  customerType?: "retail" | "wholesale";
}) {
  return {
    id: String(user._id),
    type: user.type,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerified: Boolean(user.emailVerifiedAt),
    roleSlug: user.roleSlug,
    customerType: user.customerType,
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
