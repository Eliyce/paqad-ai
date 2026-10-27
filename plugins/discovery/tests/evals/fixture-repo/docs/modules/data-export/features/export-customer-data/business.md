# Export a customer's data

Invented fixture content for testing only.

## Roles

A customer asks for a copy of their data. A support agent runs the export. A privacy reviewer signs
off before any export that includes personal data leaves the company.

## What this already does

Exporting a customer's own data already exists today. A support agent opens the customer's account,
requests an export, and the system gathers the customer's profile, saved addresses, order history,
and support messages into a single downloadable file. The customer is emailed a secure, expiring
link to collect it.

## Business rules

- An export includes personal data: the customer's name, email, addresses, and order history.
- Only a signed-in support agent can start an export, and every export is logged with who ran it.
- The download link expires after a short window and can be collected only once.
- An export that includes personal data needs privacy sign-off before it is shared outside support.

## Record notifications, jobs, integrations

Record notifications, jobs, integrations for how an export is delivered to a customer in another
region.
