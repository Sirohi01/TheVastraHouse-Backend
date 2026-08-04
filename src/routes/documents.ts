import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { OrderDocument, orderDocumentTypes } from "../models/OrderDocument.js";
import { generateOrderDocument, resendOrderDocument } from "../services/invoiceService.js";

export const documentsRouter = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);

documentsRouter.use(requireAuth);

documentsRouter.get("/me", async (req, res, next) => {
  try {
    const documents = await OrderDocument.find({ userId: req.user!.id })
      .sort({ issuedAt: -1 })
      .lean();
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

documentsRouter.get(
  "/admin",
  requirePermission({ module: "orders", action: "read" }),
  async (_req, res, next) => {
    try {
      const documents = await OrderDocument.find({}).sort({ issuedAt: -1 }).limit(250).lean();
      res.json({ documents });
    } catch (error) {
      next(error);
    }
  },
);

documentsRouter.post(
  "/admin/generate",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z
      .object({
        amountOverride: z.coerce.number().positive().optional(),
        orderId: objectId,
        returnRequestId: objectId.optional(),
        type: z.enum(orderDocumentTypes),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const document = await generateOrderDocument(req.body);
      res.status(201).json({ document });
    } catch (error) {
      next(error);
    }
  },
);

documentsRouter.post(
  "/admin/:id/resend",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z.object({ to: z.string().email().optional() }).strict(),
    params: z.object({ id: objectId }).strict(),
  }),
  async (req, res, next) => {
    try {
      const document = await resendOrderDocument(String(req.params.id), req.body.to);
      res.json({ document });
    } catch (error) {
      next(error);
    }
  },
);

documentsRouter.get(
  "/:id/pdf",
  validateRequest({ params: z.object({ id: objectId }).strict() }),
  async (req, res, next) => {
    try {
      const filter = {
        _id: req.params.id,
        ...(req.user!.type === "customer" ? { userId: req.user!.id } : {}),
      };
      const document = await OrderDocument.findOne(filter).select("+pdf.data");
      if (!document?.pdf?.data) {
        res.status(404).json({ error: { message: "Document not found" } });
        return;
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${document.documentNumber.replace(/\//g, "-")}.pdf"`,
      );
      res.send(document.pdf.data);
    } catch (error) {
      next(error);
    }
  },
);
