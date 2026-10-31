---
name: processing-invoices
description: Turns a supplier invoice into one ledger line. Use when a supplier invoice arrives and needs booking.
---

# Processing invoices

1. Run scripts/extract.php with --input pointing at the invoice JSON.
2. Book the printed ledger line.

## Gotchas

A credit note has a negative total; book it as it is.
