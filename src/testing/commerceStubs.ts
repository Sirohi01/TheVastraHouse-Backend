import { GiftCard } from "../models/GiftCard.js";
import { GiftCardTransaction } from "../models/GiftCardTransaction.js";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";

/**
 * Test-only helpers: replaces model statics with in-memory fakes so service tests run without
 * MongoDB. Every stub returns a restore function; tests must call it in `t.after`.
 */
type AnyModel = Record<string, unknown>;

export function stubStatics(model: unknown, overrides: Record<string, unknown>) {
  const target = model as AnyModel;
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, target[key]]));

  for (const [key, value] of Object.entries(overrides)) {
    target[key] = value;
  }

  return () => {
    for (const [key, value] of Object.entries(originals)) {
      target[key] = value;
    }
  };
}

export function queryResult<T>(value: T) {
  const query = {
    distinct: () => Promise.resolve([]),
    lean: () => Promise.resolve(value),
    limit: () => query,
    populate: () => query,
    select: () => query,
    skip: () => query,
    sort: () => query,
    then: (resolve: (result: T) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return query;
}

/**
 * Atomic-claim fake for PaymentSession.updateOne({ _id, capturedPaymentIds: { $ne: key } }).
 * The first claim for a (session, key) pair succeeds; replays report modifiedCount 0.
 */
export function stubPaymentCaptureClaims() {
  const claimed = new Set<string>();

  return stubStatics(PaymentSession, {
    updateOne: (
      filter: { _id?: unknown; capturedPaymentIds?: { $ne?: string } },
    ) => {
      const key = `${String(filter._id)}:${filter.capturedPaymentIds?.$ne ?? ""}`;

      if (!filter.capturedPaymentIds?.$ne) {
        return Promise.resolve({ modifiedCount: 1 });
      }

      if (claimed.has(key)) {
        return Promise.resolve({ modifiedCount: 0 });
      }

      claimed.add(key);
      return Promise.resolve({ modifiedCount: 1 });
    },
  });
}

/** Stubs the read-only checks checkout performs besides the cart itself. */
export function stubCheckoutAuxiliaryQueries() {
  const restoreOrder = stubStatics(Order, {
    countDocuments: () => Promise.resolve(0),
    distinct: () => Promise.resolve([]),
    find: () => queryResult([]),
    updateOne: () => Promise.resolve({ modifiedCount: 1 }),
  });
  const restoreHistory = stubStatics(PaymentHistory, {
    countDocuments: () => Promise.resolve(0),
  });
  const restoreSessionFind = stubStatics(PaymentSession, { find: () => queryResult([]) });

  return () => {
    restoreOrder();
    restoreHistory();
    restoreSessionFind();
  };
}

/** In-memory gift cards keyed by code, with conditional debit semantics. */
export function stubGiftCards(cards: Record<string, number>) {
  const balances = new Map(Object.entries(cards).map(([code, balance]) => [code, balance]));
  const transactions: Array<Record<string, unknown>> = [];
  const card = (code: string) => ({
    _id: code,
    balance: balances.get(code) ?? 0,
    code,
    currencyCode: "INR",
    status: "active",
  });
  const restoreCards = stubStatics(GiftCard, {
    findByIdAndUpdate: (id: string, update: { $inc?: { balance?: number } }) => {
      balances.set(id, (balances.get(id) ?? 0) + (update.$inc?.balance ?? 0));
      return queryResult(card(id));
    },
    findOne: (filter: { code: string }) =>
      queryResult(balances.has(filter.code) ? card(filter.code) : null),
    findOneAndUpdate: (
      filter: { code: string; balance?: { $gte?: number } },
      update: { $inc?: { balance?: number } },
    ) => {
      const balance = balances.get(filter.code);

      if (balance === undefined || balance < (filter.balance?.$gte ?? 0)) {
        return Promise.resolve(null);
      }

      balances.set(filter.code, balance + (update.$inc?.balance ?? 0));
      return Promise.resolve(card(filter.code));
    },
  });
  const restoreTransactions = stubStatics(GiftCardTransaction, {
    create: (payload: Record<string, unknown>) => {
      transactions.push(payload);
      return Promise.resolve({ _id: transactions.length, ...payload });
    },
    updateOne: () => Promise.resolve({ modifiedCount: 1 }),
  });

  return {
    balances,
    transactions,
    restore() {
      restoreCards();
      restoreTransactions();
    },
  };
}
