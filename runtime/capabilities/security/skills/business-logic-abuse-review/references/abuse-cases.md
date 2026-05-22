# Abuse Cases

## Financial Manipulation

- **Negative quantity / amount**: send `quantity: -1` or `amount: -100` in payment/order flows — refund reversal, gift card drain
- **Price parameter tampering**: client-submitted `price=0` or `price=0.01` in order payload
- **Coupon / discount stacking**: apply promo → remove qualifying item from cart → discount persists
- **Currency rounding abuse**: repeated micro-transactions that accumulate rounding gains
- **Quantity zero or null bypass**: zero-quantity order passes validation, triggers fulfillment or loyalty credit

## Race Conditions / TOCTOU

- **Concurrent duplicate submission**: fire identical high-value POST simultaneously — double-charge, double-redeem, or over-allocate inventory
- **HTTP/2 single-packet attack**: bundle 20–30 identical checkout/redeem requests into one TCP packet to eliminate network jitter and reliably collapse the race window — bypasses naive rate-limit-based race detection
- **Idempotency key reuse**: reuse same idempotency key across different users or different amounts
- **Single-use token TOCTOU**: fire parallel requests against a password reset link, email confirmation link, or one-time promo code before the "used" flag is written
- **Database-level TOCTOU**: SELECT-then-UPDATE without row locking or serializable isolation — concurrent requests both pass the check

## Workflow / State Machine Abuse

- **Step-skipping**: submit checkout before payment step completes; skip email verification before granting access
- **State replay**: replay a previous legitimate state transition to re-enter a completed step
- **State machine reversal**: attempt to transition back to an earlier state (reopen a closed order, undelete a record)
- **Out-of-order API calls**: call step 3 before step 1 to skip validation that only runs in step 1
- **Approval chain bypass**: lower-privilege actor re-approving their own escalated request via indirect path
- **Privilege inheritance abuse**: grant permission to user B → B elevates to admin via inherited scope
- **Workflow interleave**: start two conflicting workflows for the same resource simultaneously

## GraphQL-Specific Abuse

- **Query batching rate-limit bypass**: single HTTP request containing 50+ aliased login mutations for credential stuffing
- **Nested query depth attack**: deeply recursive query (`user { friends { friends { ... } } }`) to exhaust server CPU/memory without per-request cost limits
- **Alias overloading**: duplicate the same expensive field 100+ times under different aliases in one query
- **Introspection in production**: `{ __schema { types { name fields { name } } } }` leaks the entire API surface to unauthenticated callers
- **Mutation parameter manipulation**: modify fields not exposed in the UI but present in the schema (discovered via introspection)
