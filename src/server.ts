import { env, isProduction } from "./config/env.js";
import { connectMongo } from "./db/mongoose.js";
import { createApp } from "./app.js";
import { startMerchandisingBadgeJob } from "./services/merchandisingBadgeService.js";
import { startAbandonedCartJob, startWishlistSignalJob } from "./services/cartService.js";
import { seedDefaultRoles } from "./services/roleSeedService.js";
import { logger } from "./utils/logger.js";

async function bootstrap() {
  if (isProduction) {
    await connectMongo();
    await seedDefaultRoles();
  } else {
    void connectMongo()
      .then(seedDefaultRoles)
      .catch((error) => {
        logger.warn(
          { error },
          "MongoDB unavailable; API is running with disconnected health status",
        );
      });
  }

  const app = createApp();
  const port = env.PORT ?? env.BACKEND_PORT;
  const server = app.listen(port, () => {
    logger.info({ port }, "Backend server is running");
  });
  const merchandisingBadgeJob = startMerchandisingBadgeJob();
  const abandonedCartJob = startAbandonedCartJob();
  const wishlistSignalJob = startWishlistSignalJob();

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Shutting down backend server");
    clearInterval(merchandisingBadgeJob);
    clearInterval(abandonedCartJob);
    clearInterval(wishlistSignalJob);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  logger.fatal({ error }, "Backend bootstrap failed");
  process.exit(1);
});
