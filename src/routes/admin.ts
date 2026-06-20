import { Router } from "express";
import { AppError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { LowStockAlert } from "../models/LowStockAlert.js";
import { Order } from "../models/Order.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Product } from "../models/Product.js";
import { ProductionTracker } from "../models/ProductionTracker.js";
import { ReturnRequest } from "../models/ReturnRequest.js";
import { StockLedger } from "../models/StockLedger.js";

export const adminRouter = Router();

const REVENUE_ORDER_STATUSES = [
  "confirmed",
  "pre_order_confirmed",
  "cod_confirmed",
  "in_production",
  "packed",
  "ready_to_dispatch",
  "shipped",
  "delivered",
];

const DASHBOARD_WINDOW_DAYS = 30;
const TREND_WINDOW_DAYS = 14;
const DASHBOARD_TIMEZONE = "Asia/Kolkata";

adminRouter.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    if (req.user?.type !== "admin") {
      throw new AppError("Permission denied", 403);
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - DASHBOARD_WINDOW_DAYS * 86_400_000);
    const trendStart = new Date(now.getTime() - (TREND_WINDOW_DAYS - 1) * 86_400_000);

    const [
      pendingOrders,
      paymentVerification,
      lowStockAlerts,
      returnsQueue,
      productCount,
      activePreOrders,
      stockSummary,
      revenueTrendRows,
      orderStatusRows,
      paymentMethodRows,
      topProductRows,
    ] = await Promise.all([
      Order.countDocuments({
        status: { $in: ["pending_payment", "payment_verification_pending", "confirmed"] },
      }),
      PaymentSession.countDocuments({
        status: { $in: ["payment_verification_pending", "upi_pending"] },
      }),
      LowStockAlert.countDocuments({ status: "open" }),
      ReturnRequest.countDocuments({ status: "requested" }),
      Product.countDocuments({ status: { $ne: "deleted" } }),
      ProductionTracker.countDocuments({
        stage: { $ne: "dispatch" },
      }),
      StockLedger.aggregate([
        {
          $group: {
            _id: null,
            available: { $sum: "$available" },
            damaged: { $sum: "$damaged" },
            incoming: { $sum: "$incoming" },
            reserved: { $sum: "$reserved" },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: trendStart },
            status: { $in: REVENUE_ORDER_STATUSES },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                date: "$createdAt",
                format: "%Y-%m-%d",
                timezone: DASHBOARD_TIMEZONE,
              },
            },
            orders: { $sum: 1 },
            revenue: { $sum: "$totals.grandTotal" },
          },
        },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: windowStart } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: windowStart },
            status: { $in: REVENUE_ORDER_STATUSES },
          },
        },
        {
          $group: {
            _id: "$paymentMethod",
            count: { $sum: 1 },
            revenue: { $sum: "$totals.grandTotal" },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: windowStart },
            status: { $in: REVENUE_ORDER_STATUSES },
          },
        },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.sku",
            productName: { $first: "$items.productName" },
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.lineSubtotal" },
          },
        },
        { $sort: { quantity: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const revenueTrend = buildDailyRevenueSeries(trendStart, now, revenueTrendRows);
    const totalRevenue30d = paymentMethodRows.reduce(
      (sum: number, row: { revenue: number }) => sum + row.revenue,
      0,
    );
    const totalOrders30d = paymentMethodRows.reduce(
      (sum: number, row: { count: number }) => sum + row.count,
      0,
    );

    res.json({
      summary: {
        activePreOrders,
        inventory: stockSummary[0] ?? { available: 0, damaged: 0, incoming: 0, reserved: 0 },
        lowStockAlerts,
        paymentVerification,
        pendingOrders,
        productCount,
        returnsQueue,
      },
      charts: {
        averageOrderValue30d: totalOrders30d ? Math.round(totalRevenue30d / totalOrders30d) : 0,
        orderStatusBreakdown: orderStatusRows.map((row: { _id: string; count: number }) => ({
          count: row.count,
          status: row._id,
        })),
        paymentMethodBreakdown: paymentMethodRows.map(
          (row: { _id: string; count: number; revenue: number }) => ({
            count: row.count,
            method: row._id,
            revenue: row.revenue,
          }),
        ),
        revenueTrend,
        topProducts: topProductRows.map(
          (row: { _id: string; productName: string; quantity: number; revenue: number }) => ({
            productName: row.productName,
            quantity: row.quantity,
            revenue: row.revenue,
            sku: row._id,
          }),
        ),
        totalOrders30d,
        totalRevenue30d,
      },
    });
  } catch (error) {
    next(error);
  }
});

function buildDailyRevenueSeries(
  start: Date,
  end: Date,
  rows: Array<{ _id: string; orders: number; revenue: number }>,
) {
  const byDate = new Map(rows.map((row) => [row._id, row]));
  const days: Array<{ date: string; orders: number; revenue: number }> = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toLocaleDateString("en-CA", { timeZone: DASHBOARD_TIMEZONE });
    const row = byDate.get(key);
    days.push({ date: key, orders: row?.orders ?? 0, revenue: row?.revenue ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}
