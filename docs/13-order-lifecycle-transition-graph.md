# Phase 13 Order Lifecycle Transition Graph

This is the Phase 13 sign-off artifact for order-status movement. The implementation must use this graph as the source for allowed admin/system transitions, with customer actions limited to cancellation only.

## Statuses

- `pending_payment`
- `payment_verification_pending`
- `payment_rejected`
- `confirmed`
- `pre_order_confirmed`
- `cod_confirmed`
- `in_production`
- `packed`
- `ready_to_dispatch`
- `shipped`
- `delivered`
- `cancelled`
- `returned`
- `refunded`

## Allowed Transitions

| From | To |
|---|---|
| `pending_payment` | `confirmed`, `payment_verification_pending`, `payment_rejected`, `cancelled` |
| `payment_verification_pending` | `confirmed`, `payment_rejected`, `cancelled` |
| `payment_rejected` | `pending_payment`, `cancelled` |
| `confirmed` | `in_production`, `packed`, `ready_to_dispatch`, `cancelled` |
| `pre_order_confirmed` | `in_production`, `cancelled` |
| `cod_confirmed` | `in_production`, `packed`, `ready_to_dispatch`, `cancelled` |
| `in_production` | `packed`, `cancelled` |
| `packed` | `ready_to_dispatch`, `cancelled` |
| `ready_to_dispatch` | `shipped`, `cancelled` |
| `shipped` | `delivered`, `returned` |
| `delivered` | `returned`, `refunded` |
| `returned` | `refunded` |
| `cancelled` | Terminal |
| `refunded` | Terminal |

## Actor Rules

- Admin/system transitions must follow the graph above.
- Customers can only request `cancelled`, and only before dispatch.
- Admin cancellation is allowed from any non-terminal stage.
- Every accepted transition must create a status timeline entry with actor, timestamp, target status, and optional note.
- Cancellation must release or restock Phase 12 inventory reservations before the order is saved as cancelled.
