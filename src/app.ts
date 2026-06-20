import express from "express";
import { API_VERSION } from "./config/api.js";
import { securityMiddleware } from "./config/security.js";
import { requestId, errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { cmsRouter } from "./routes/cms.js";
import { commerceRouter } from "./routes/commerce.js";
import { healthRouter } from "./routes/health.js";
import { mediaRouter } from "./routes/media.js";
import { paymentsRouter, paymentWebhookRouter } from "./routes/payments.js";
import { catalogRouter } from "./routes/catalog.js";
import { checkoutRouter } from "./routes/checkout.js";
import { inventoryRouter } from "./routes/inventory.js";
import { ordersRouter } from "./routes/orders.js";
import { preOrdersRouter } from "./routes/preOrders.js";
import { returnsRouter } from "./routes/returns.js";
import { settingsRouter } from "./routes/settings.js";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(requestLogger);
  app.use(securityMiddleware);
  app.use(`/api/${API_VERSION}/payments`, paymentWebhookRouter);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  app.use(`/api/${API_VERSION}/health`, healthRouter);
  app.use(`/api/${API_VERSION}/auth`, authRouter);
  app.use(`/api/${API_VERSION}/admin`, adminRouter);
  app.use(`/api/${API_VERSION}/cms`, cmsRouter);
  app.use(`/api/${API_VERSION}/commerce`, commerceRouter);
  app.use(`/api/${API_VERSION}/catalog`, catalogRouter);
  app.use(`/api/${API_VERSION}/media`, mediaRouter);
  app.use(`/api/${API_VERSION}/payments`, paymentsRouter);
  app.use(`/api/${API_VERSION}/checkout`, checkoutRouter);
  app.use(`/api/${API_VERSION}/inventory`, inventoryRouter);
  app.use(`/api/${API_VERSION}/orders`, ordersRouter);
  app.use(`/api/${API_VERSION}/pre-orders`, preOrdersRouter);
  app.use(`/api/${API_VERSION}/returns`, returnsRouter);
  app.use(`/api/${API_VERSION}/settings`, settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
