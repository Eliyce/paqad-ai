# Send an order to SAP

Invented fixture content for testing only. SAP here is the finance and logistics system of record
that orders are handed to; it is not a vendor of this plugin.

## Roles

A customer places an order. An order job hands the completed order to SAP. A finance reviewer
reconciles what SAP received against what was placed.

## Order types we send to SAP

We send several kinds of order to SAP. Each row is one type with a one-line description.

| Order type | What it is |
|---|---|
| Standard sales order | A normal paid order shipped from a warehouse. |
| Subscription renewal order | An order raised automatically when a plan renews. |
| Replacement order | A no-charge order that replaces a damaged or lost item. |
| Return credit order | A credit raised when an approved return is refunded. |
| Gift order | A paid order shipped to a different person than the buyer. |

## How sending works

When an order is fully paid and stock is confirmed, the order job builds a message for that order
and places it on the outbound queue. SAP reads the queue, creates the matching document, and sends
back an acknowledgement with its own reference. The order is marked sent once that acknowledgement
arrives; if none arrives within the window, the job retries and then flags the order for a human.

## Business rules

- An order is sent to SAP only after it is fully paid and stock is confirmed.
- Each order is sent at most once; a retry reuses the same order reference so SAP never duplicates it.
- A return credit order is sent only after the return passes inspection.
