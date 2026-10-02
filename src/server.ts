import { env, isProduction } from "./config/env.js";
import { connectMongo } from "./db/mongoose.js";
import { createApp } from "./app.js";
import { recomputeProductBadges } from "./services/merchandisingBadgeService.js";
import { emitAbandonedCartEvents, refreshWishlistSignals } from "./services/cartService.js";
import { processNotificationQueue } from "./services/notificationDispatchService.js";
import { cancelExpiredPendingPaymentOrders } from "./services/orderLifecycleService.js";
import { runLowStockAlertJob } from "./services/inventoryService.js";
import { closeExpiredPreOrders } from "./services/preOrderService.js";
import { seedDefaultRoles } from "./services/roleSeedService.js";
import { reconcileOrderDocuments } from "./services/invoiceService.js";
import { processBackInStockAlerts } from "./services/engagementService.js";
import {
  processScheduledCampaigns,
  runAbandonedCartRecovery,
  runReviewRequests,
  runWelcomeEmails,
  runWinBackCampaign,
} from "./services/marketingService.js";
import { publishScheduledPosts, seedDefaultPolicyPages } from "./services/contentService.js";
import { recomputeCustomerSegments } from "./services/crmService.js";
import { expireRewardPoints } from "./services/rewardPointsService.js";
import { expireGiftCards } from "./services/giftCardService.js";
import { registerJob, startScheduler, stopScheduler } from "./services/schedulerService.js";
import { logger } from "./utils/logger.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function registerJobs() {
  registerJob({
    description: "Deliver queued emails/WhatsApp with retries",
    intervalMs: env.NOTIFICATION_DISPATCH_JOB_INTERVAL_SECONDS * 1000,
    name: "notifications",
    run: () => processNotificationQueue(),
  });
  registerJob({
    description: "Cancel unpaid orders after 30 minutes (releases stock and credits)",
    intervalMs: 5 * MINUTE,
    name: "pending-payment-cleanup",
    run: () => cancelExpiredPendingPaymentOrders(),
  });
  registerJob({
    description: "Close pre-orders past their end date or cap",
    intervalMs: 5 * MINUTE,
    name: "pre-order-auto-close",
    run: () => closeExpiredPreOrders(),
  });
  registerJob({
    description: "Recompute New Arrival / Best Seller / Trending badges",
    intervalMs: env.MERCHANDISING_BADGE_JOB_INTERVAL_MINUTES * MINUTE,
    name: "merchandising-badges",
    run: () => recomputeProductBadges(),
  });
  registerJob({
    description: "Emit abandoned-cart events for inactive carts",
    intervalMs: env.ABANDONED_CART_JOB_INTERVAL_MINUTES * MINUTE,
    name: "abandoned-cart-events",
    run: () => emitAbandonedCartEvents(),
  });
  registerJob({
    description: "Refresh wishlist price and stock signals",
    intervalMs: env.WISHLIST_SIGNAL_JOB_INTERVAL_MINUTES * MINUTE,
    name: "wishlist-signals",
    run: () => refreshWishlistSignals(),
  });
  registerJob({
    description: "Raise low-stock alerts",
    intervalMs: 10 * MINUTE,
    name: "low-stock-alerts",
    run: () => runLowStockAlertJob(),
  });
  registerJob({
    description: "Generate missing invoices/credit notes",
    intervalMs: 10 * MINUTE,
    name: "document-reconciliation",
    run: () => reconcileOrderDocuments(),
  });
  registerJob({
    description: "Email back-in-stock subscribers when stock returns",
    intervalMs: 10 * MINUTE,
    name: "back-in-stock",
    run: () => processBackInStockAlerts(),
  });
  registerJob({
    description: "Abandoned-cart recovery emails",
    intervalMs: 30 * MINUTE,
    name: "abandoned-cart-recovery",
    run: () => runAbandonedCartRecovery(),
  });
  registerJob({
    description: "Win-back emails to inactive customers",
    intervalMs: 24 * HOUR,
    name: "win-back",
    run: () => runWinBackCampaign(),
  });
  registerJob({
    description: "Post-delivery review request emails",
    intervalMs: HOUR,
    name: "review-requests",
    run: () => runReviewRequests(),
  });
  registerJob({
    description: "Welcome emails for new customers",
    intervalMs: HOUR,
    name: "welcome-emails",
    run: () => runWelcomeEmails(),
  });
  registerJob({
    description: "Send scheduled marketing campaigns",
    intervalMs: 5 * MINUTE,
    name: "campaign-scheduler",
    run: () => processScheduledCampaigns(),
  });
  registerJob({
    description: "Publish scheduled blog articles",
    intervalMs: 5 * MINUTE,
    name: "blog-publisher",
    run: () => publishScheduledPosts(),
  });
  registerJob({
    description: "Recompute customer LTV and segments",
    intervalMs: 6 * HOUR,
    name: "crm-segments",
    run: () => recomputeCustomerSegments(),
  });
  registerJob({
    description: "Expire unused reward points",
    intervalMs: 6 * HOUR,
    name: "points-expiry",
    run: () => expireRewardPoints(),
  });
  registerJob({
    description: "Expire gift cards past validity",
    intervalMs: 6 * HOUR,
    name: "gift-card-expiry",
    run: () => expireGiftCards(),
  });
}

async function initialiseData() {
  await seedDefaultRoles();
  const pages = await seedDefaultPolicyPages();
  if (pages.created) {
    logger.info(pages, "Seeded default policy pages; review their text before launch");
  }
}

async function bootstrap() {
  if (isProduction) {
    await connectMongo();
    await initialiseData();
  } else {
    void connectMongo()
      .then(initialiseData)
      .catch((error) => {
        logger.warn(
          { error },
          "MongoDB unavailable; API is running with disconnected health status",
        );
      });
  }

  registerJobs();
  const app = createApp();
  const port = env.PORT ?? env.BACKEND_PORT;
  const server = app.listen(port, () => {
    logger.info({ port }, "Backend server is running");
  });
  startScheduler();

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Shutting down backend server");
    stopScheduler();
    server.close(() => {
      process.exit(0);
    });
    // Force exit if connections do not drain.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ error }, "Uncaught exception; exiting");
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  logger.fatal({ error }, "Backend bootstrap failed");
  process.exit(1);
});
