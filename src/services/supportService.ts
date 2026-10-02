import crypto from "node:crypto";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  SupportTicket,
  type ticketCategories,
  type ticketStatuses,
} from "../models/SupportTicket.js";
import { User } from "../models/User.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";
import { enqueueNotification } from "./notificationDispatchService.js";

type TicketCategory = (typeof ticketCategories)[number];
type TicketStatus = (typeof ticketStatuses)[number];
type Priority = "low" | "normal" | "high" | "urgent";

const SLA_HOURS: Record<Priority, number> = { high: 12, low: 72, normal: 24, urgent: 4 };

function ticketNumber() {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return `TKT-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function priorityFor(category: TicketCategory): Priority {
  if (category === "payment") return "high";
  if (category === "order" || category === "return") return "normal";
  return "low";
}

/** Contact form (Phase 26) → helpdesk ticket (Phase 33). Honeypot-protected and rate limited. */
export async function createTicketFromContactForm(input: {
  name: string;
  email: string;
  phone?: string;
  category: TicketCategory;
  subject: string;
  message: string;
  orderNumber?: string;
  userId?: string;
  ipAddress?: string;
  source?: "contact_form" | "account";
}) {
  const email = input.email.trim().toLowerCase();
  const priority = priorityFor(input.category);
  const ticket = await SupportTicket.create({
    category: input.category,
    email,
    ipAddress: input.ipAddress,
    messages: [{ authorType: "customer", body: input.message }],
    name: input.name,
    orderNumber: input.orderNumber?.trim().toUpperCase() || undefined,
    phone: input.phone,
    priority,
    slaDueAt: new Date(Date.now() + SLA_HOURS[priority] * 3_600_000),
    source: input.source ?? "contact_form",
    status: "open",
    subject: input.subject,
    ticketNumber: ticketNumber(),
    userId: input.userId,
  });

  await enqueueNotification({
    channel: "email",
    eventType: "support_ticket_received",
    fallback: {
      subject: `We received your message (${ticket.ticketNumber})`,
      text: `Hi ${input.name},\n\nThanks for contacting The Vastra House. Your reference is ${ticket.ticketNumber}. Our team usually replies within ${SLA_HOURS[priority]} hours.\n\nYour message:\n${input.message}`,
    },
    to: email,
    variables: { name: input.name, ticketNumber: ticket.ticketNumber },
  });

  const supportInbox =
    (await getRuntimeSetting("COMPANY_EMAIL")) || env.COMPANY_EMAIL || env.SMTP_FROM_EMAIL;
  if (supportInbox) {
    await enqueueNotification({
      channel: "email",
      eventType: "support_ticket_staff_alert",
      fallback: {
        subject: `[${ticket.ticketNumber}] ${input.category}: ${input.subject}`,
        text: `New ${priority} priority ticket from ${input.name} <${email}>${input.orderNumber ? ` about order ${input.orderNumber}` : ""}.\n\n${input.message}\n\nOpen in admin: ${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}/admin/support?ticket=${ticket.ticketNumber}`,
      },
      to: supportInbox,
      variables: {},
    });
  }

  return { ticketNumber: ticket.ticketNumber };
}

export async function listTickets(
  filter: { status?: string; assignedTo?: string; search?: string; overdue?: boolean },
  pagination: PaginationOptions,
) {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  else query.status = { $nin: ["closed", "spam"] };
  if (filter.assignedTo) query.assignedTo = filter.assignedTo;
  if (filter.overdue) {
    query.slaDueAt = { $lt: new Date() };
    query.status = { $in: ["open"] };
  }
  if (filter.search) {
    const pattern = { $options: "i", $regex: filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
    query.$or = [
      { ticketNumber: pattern },
      { email: pattern },
      { subject: pattern },
      { orderNumber: pattern },
    ];
  }

  const [items, total, openCount, overdueCount] = await Promise.all([
    SupportTicket.find(query)
      .select("-messages")
      .populate("assignedTo", "email firstName lastName")
      .sort({ slaDueAt: 1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    SupportTicket.countDocuments(query),
    SupportTicket.countDocuments({ status: "open" }),
    SupportTicket.countDocuments({ slaDueAt: { $lt: new Date() }, status: "open" }),
  ]);

  return { ...buildPaginatedResult(items, total, pagination), openCount, overdueCount };
}

export async function getTicket(ticketNumber: string, options: { customerEmail?: string } = {}) {
  const ticket = (await SupportTicket.findOne({
    ticketNumber: ticketNumber.toUpperCase(),
    ...(options.customerEmail ? { email: options.customerEmail } : {}),
  })
    .populate("assignedTo", "email firstName lastName")
    .lean()) as unknown as
    | (Record<string, unknown> & { messages: Array<{ internal?: boolean }> })
    | null;

  if (!ticket) {
    throw new AppError("Ticket not found", 404);
  }

  if (options.customerEmail) {
    // Internal agent notes never reach the customer.
    return {
      ...ticket,
      assignedTo: undefined,
      ipAddress: undefined,
      messages: ticket.messages.filter((message) => !message.internal),
    };
  }

  return ticket;
}

export async function replyToTicket(input: {
  ticketNumber: string;
  body: string;
  internal?: boolean;
  agentId?: string;
  customerEmail?: string;
  status?: TicketStatus;
}) {
  const ticket = await SupportTicket.findOne({
    ticketNumber: input.ticketNumber.toUpperCase(),
    ...(input.customerEmail ? { email: input.customerEmail } : {}),
  });

  if (!ticket) {
    throw new AppError("Ticket not found", 404);
  }

  if (input.customerEmail && ["closed", "spam"].includes(ticket.status)) {
    throw new AppError("This ticket is closed. Please open a new request.", 409);
  }

  const fromAgent = Boolean(input.agentId);
  ticket.messages.push({
    authorId: input.agentId ? new Types.ObjectId(input.agentId) : ticket.userId,
    authorType: fromAgent ? "agent" : "customer",
    body: input.body,
    createdAt: new Date(),
    internal: fromAgent && Boolean(input.internal),
  });

  if (fromAgent && !input.internal) {
    ticket.firstResponseAt ??= new Date();
    ticket.status = input.status ?? "pending_customer";
  } else if (!fromAgent) {
    ticket.status = "open";
  }

  if (input.status && fromAgent) {
    ticket.status = input.status;
  }

  if (ticket.status === "resolved") ticket.resolvedAt = new Date();
  await ticket.save();

  if (fromAgent && !input.internal) {
    await enqueueNotification({
      channel: "email",
      eventType: "support_ticket_reply",
      fallback: {
        subject: `Re: ${ticket.subject} (${ticket.ticketNumber})`,
        text: `Hi ${ticket.name},\n\n${input.body}\n\nReply from your account: ${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}/account/support/${ticket.ticketNumber}`,
      },
      to: ticket.email,
      variables: { ticketNumber: ticket.ticketNumber },
    });
  }

  return ticket;
}

export async function updateTicket(
  ticketNumber: string,
  input: {
    status?: TicketStatus;
    priority?: Priority;
    assignedTo?: string | null;
    category?: TicketCategory;
  },
) {
  const ticket = await SupportTicket.findOne({ ticketNumber: ticketNumber.toUpperCase() });

  if (!ticket) throw new AppError("Ticket not found", 404);

  if (input.status) {
    ticket.status = input.status;
    if (input.status === "resolved") ticket.resolvedAt = new Date();
  }
  if (input.priority) {
    ticket.priority = input.priority;
    ticket.slaDueAt = new Date(ticket.createdAt.getTime() + SLA_HOURS[input.priority] * 3_600_000);
  }
  if (input.category) ticket.category = input.category;
  if (input.assignedTo !== undefined) {
    if (input.assignedTo) {
      const agent = await User.exists({ _id: input.assignedTo, type: "admin" });
      if (!agent) throw new AppError("Assignee must be a staff account", 400);
    }
    ticket.set("assignedTo", input.assignedTo ?? undefined);
  }

  await ticket.save();
  return ticket;
}

export async function listCustomerTickets(email: string) {
  return SupportTicket.find({ email, status: { $ne: "spam" } })
    .select("ticketNumber subject category status createdAt updatedAt")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}
