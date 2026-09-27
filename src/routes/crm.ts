import { Router } from "express";
import { z } from "zod";
import {
  requireAnyPermission,
  requireAuth,
  requirePermission,
} from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { ticketCategories, ticketStatuses } from "../models/SupportTicket.js";
import {
  addCustomerNote,
  getCustomerProfile,
  getSegmentCounts,
  listCustomers,
  recomputeCustomerSegments,
  setCustomerTags,
} from "../services/crmService.js";
import { listPrivacyRequests, processDeletionRequest } from "../services/privacyService.js";
import { getTicket, listTickets, replyToTicket, updateTicket } from "../services/supportService.js";
import { listWholesaleAccounts, reviewWholesaleApplication } from "../services/wholesaleService.js";
import { parsePagination } from "../utils/pagination.js";

export const crmRouter = Router();
crmRouter.use(requireAuth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const readCustomers = requireAnyPermission(
  { action: "read", module: "crm" },
  { action: "read", module: "customers" },
);
const manageCustomers = requireAnyPermission(
  { action: "manage", module: "crm" },
  { action: "manage", module: "customers" },
);
const support = requirePermission({ action: "manage", module: "support" });

// ---------------- Customers / CRM ----------------

crmRouter.get("/customers", readCustomers, async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json({
      ...(await listCustomers(
        { customerType: q.customerType, search: q.search, segment: q.segment, tag: q.tag },
        parsePagination(req.query),
      )),
      segmentCounts: await getSegmentCounts(),
    });
  } catch (error) {
    next(error);
  }
});

crmRouter.get("/customers/:id", readCustomers, validateRequest({ params: z.object({ id: objectId }).strict() }), async (req, res, next) => {
  try {
    res.json(await getCustomerProfile(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

crmRouter.post(
  "/customers/:id/notes",
  requireAnyPermission({ action: "manage", module: "crm" }, { action: "manage", module: "customers" }, { action: "manage", module: "support" }),
  validateRequest({ params: z.object({ id: objectId }).strict(), body: z.object({ body: z.string().trim().min(2).max(2000) }).strict() }),
  async (req, res, next) => {
    try {
      res.status(201).json({ crm: await addCustomerNote(String(req.params.id), req.body.body, req.user!.id) });
    } catch (error) {
      next(error);
    }
  },
);

crmRouter.put(
  "/customers/:id/tags",
  manageCustomers,
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(30) }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({ crm: await setCustomerTags(String(req.params.id), req.body.tags) });
    } catch (error) {
      next(error);
    }
  },
);

crmRouter.post("/segments/recompute", manageCustomers, async (_req, res, next) => {
  try {
    res.json(await recomputeCustomerSegments());
  } catch (error) {
    next(error);
  }
});

// ---------------- Wholesale accounts ----------------

crmRouter.get("/wholesale", readCustomers, async (req, res, next) => {
  try {
    res.json(
      await listWholesaleAccounts(
        { status: typeof req.query.status === "string" ? req.query.status : undefined },
        parsePagination(req.query),
      ),
    );
  } catch (error) {
    next(error);
  }
});

crmRouter.post(
  "/wholesale/:id/review",
  manageCustomers,
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z
      .object({
        decision: z.enum(["approve", "reject", "update"]),
        priceListCode: z.string().trim().max(40).optional(),
        paymentTerms: z.enum(["prepaid", "advance_50", "net_15", "net_30"]).optional(),
        creditLimit: z.coerce.number().min(0).optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await reviewWholesaleApplication({ ...req.body, adminUserId: req.user!.id, userId: String(req.params.id) });
      res.json({ wholesaleStatus: user.wholesaleStatus, priceListCode: user.priceListCode });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Helpdesk ----------------

crmRouter.get("/tickets", support, async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(
      await listTickets(
        { assignedTo: q.assignedTo === "me" ? req.user!.id : q.assignedTo, overdue: q.overdue === "true", search: q.search, status: q.status },
        parsePagination(req.query),
      ),
    );
  } catch (error) {
    next(error);
  }
});

crmRouter.get("/tickets/:ticketNumber", support, async (req, res, next) => {
  try {
    res.json({ ticket: await getTicket(String(req.params.ticketNumber)) });
  } catch (error) {
    next(error);
  }
});

crmRouter.post(
  "/tickets/:ticketNumber/replies",
  support,
  validateRequest({
    body: z
      .object({
        body: z.string().trim().min(1).max(5000),
        internal: z.boolean().default(false),
        status: z.enum(ticketStatuses).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      await replyToTicket({ ...req.body, agentId: req.user!.id, ticketNumber: String(req.params.ticketNumber) });
      res.json({ ticket: await getTicket(String(req.params.ticketNumber)) });
    } catch (error) {
      next(error);
    }
  },
);

crmRouter.patch(
  "/tickets/:ticketNumber",
  support,
  validateRequest({
    body: z
      .object({
        status: z.enum(ticketStatuses).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        category: z.enum(ticketCategories).optional(),
        assignedTo: objectId.nullable().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      await updateTicket(String(req.params.ticketNumber), req.body);
      res.json({ ticket: await getTicket(String(req.params.ticketNumber)) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Privacy requests ----------------

crmRouter.get("/privacy-requests", manageCustomers, async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listPrivacyRequests({ status: q.status, type: q.type }, parsePagination(req.query)));
  } catch (error) {
    next(error);
  }
});

crmRouter.post(
  "/privacy-requests/:requestNumber/process",
  requirePermission({ action: "manage", module: "users" }),
  validateRequest({
    body: z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(2000).optional() }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        request: await processDeletionRequest({
          adminUserId: req.user!.id,
          decision: req.body.decision,
          note: req.body.note,
          requestNumber: String(req.params.requestNumber),
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);
