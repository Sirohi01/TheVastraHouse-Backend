import { Router } from "express";
import { AppError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { AbandonedCartEvent } from "../models/AbandonedCartEvent.js";
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
      topCategoryRows,
      topCollectionRows,
      repeatCustomerRows,
      abandonedCartCount,
      trafficSourceRows,
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
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: windowStart },
            status: { $in: REVENUE_ORDER_STATUSES },
          },
        },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "products",
            localField: "items.productId",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        { $unwind: "$product.categoryIds" },
        {
          $lookup: {
            from: "categories",
            localField: "product.categoryIds",
            foreignField: "_id",
            as: "category",
          },
        },
        { $unwind: "$category" },
        {
          $group: {
            _id: "$category._id",
            name: { $first: "$category.name" },
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.lineSubtotal" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
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
          $lookup: {
            from: "products",
            localField: "items.productId",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        { $unwind: "$product.collectionIds" },
        {
          $lookup: {
            from: "collections",
            localField: "product.collectionIds",
            foreignField: "_id",
            as: "collection",
          },
        },
        { $unwind: "$collection" },
        {
          $group: {
            _id: "$collection._id",
            name: { $first: "$collection.name" },
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.lineSubtotal" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
      Order.aggregate([
        { $match: { userId: { $exists: true }, status: { $in: REVENUE_ORDER_STATUSES } } },
        { $group: { _id: "$userId", orders: { $sum: 1 } } },
        {
          $group: {
            _id: null,
            customers: { $sum: 1 },
            repeatCustomers: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } },
          },
        },
      ]),
      AbandonedCartEvent.countDocuments({ emittedAt: { $gte: windowStart } }),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: windowStart },
            status: { $in: REVENUE_ORDER_STATUSES },
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$attribution.utmSource", "direct"] },
            count: { $sum: 1 },
            revenue: { $sum: "$totals.grandTotal" },
          },
        },
        { $sort: { revenue: -1 } },
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
    const repeatCustomerSummary = repeatCustomerRows[0] as
      | { customers: number; repeatCustomers: number }
      | undefined;
    const repeatCustomerRate = repeatCustomerSummary?.customers
      ? repeatCustomerSummary.repeatCustomers / repeatCustomerSummary.customers
      : 0;
    const abandonedCartRate =
      totalOrders30d + abandonedCartCount
        ? abandonedCartCount / (totalOrders30d + abandonedCartCount)
        : 0;

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
        abandonedCartRate,
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
        repeatCustomerRate,
        revenueTrend,
        topCategories: topCategoryRows.map(
          (row: { _id: string; name: string; quantity: number; revenue: number }) => ({
            categoryId: String(row._id),
            name: row.name,
            quantity: row.quantity,
            revenue: row.revenue,
          }),
        ),
        topCollections: topCollectionRows.map(
          (row: { _id: string; name: string; quantity: number; revenue: number }) => ({
            collectionId: String(row._id),
            name: row.name,
            quantity: row.quantity,
            revenue: row.revenue,
          }),
        ),
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
        trafficSourceBreakdown: trafficSourceRows.map(
          (row: { _id: string; count: number; revenue: number }) => ({
            count: row.count,
            revenue: row.revenue,
            source: row._id,
          }),
        ),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/dashboard/export.csv", requireAuth, async (req, res, next) => {
  try {
    if (req.user?.type !== "admin") {
      throw new AppError("Permission denied", 403);
    }

    const rangeDays = Math.min(Math.max(Number(req.query.range) || DASHBOARD_WINDOW_DAYS, 1), 365);
    const windowStart = new Date(Date.now() - rangeDays * 86_400_000);
    const orders = await Order.find({ createdAt: { $gte: windowStart } })
      .sort({ createdAt: -1 })
      .select(
        "orderNumber createdAt status paymentMethod totals.grandTotal totals.currencyCode items attribution.utmSource",
      )
      .lean();

    const header = [
      "Order Number",
      "Date",
      "Status",
      "Payment Method",
      "Item Count",
      "Grand Total",
      "Currency",
      "Traffic Source",
    ];
    const rows = orders.map((order) => [
      order.orderNumber,
      new Date(order.createdAt).toISOString(),
      order.status,
      order.paymentMethod,
      String(order.items?.length ?? 0),
      String(order.totals?.grandTotal ?? 0),
      order.totals?.currencyCode ?? "INR",
      order.attribution?.utmSource ?? "direct",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="orders-export-${rangeDays}d.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

function csvEscape(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

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
