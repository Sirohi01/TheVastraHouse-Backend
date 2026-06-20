# Phase 14 Return & Refund Policy

This is the Phase 14 sign-off artifact for return-window and refund-method rules.

## Return Window

- Customer return requests are allowed only for orders in `delivered` status.
- The server validates the return window from the order's recorded `shipment.deliveredAt`.
- Return requests are accepted for 7 calendar days after delivery.
- Client-supplied delivery dates are ignored.

## Refund Method Eligibility

| Original Payment Method | Eligible Refund Methods |
|---|---|
| `razorpay` | `original_payment`, `store_credit` |
| `manual_bank_transfer` | `bank_transfer`, `store_credit` |
| `upi` | `bank_transfer`, `store_credit` |
| `cod` | `bank_transfer`, `store_credit` |

## Protection Rules

- COD orders cannot be refunded to original payment method.
- Refund amount cannot exceed the eligible paid/order amount recorded in the payment session.
- A return request can have only one refund record.
- A second refund attempt for an already processed return must be rejected.
- Approved returns must route stock to either restock or damaged stock through Phase 12 inventory operations.
- Credit note generation is queued as a Phase 17 document hook when a return is refunded.
