# duitku-supabase

Supabase Edge Functions integration for Duitku POP (Payment Open Platform).

> Repository source code only. No Supabase project is linked and no deployment is performed by this repository setup.

## Stack

- Supabase Edge Functions (Deno + TypeScript)
- PostgreSQL migrations
- Duitku POP HTTP API
- Web Crypto API for HMAC-SHA256
- Supabase service-role REST access from Edge Functions only

## Features

- Create Duitku invoice
- Validate Duitku HTTP callback signatures
- Persist payment transactions and callback audit events
- Query a merchant transaction from the database
- Sandbox / production endpoint selection
- No Node.js server, Express server, or Duitku SDK dependency

## Repository layout

```text
supabase/
  config.toml
  functions/
    _shared/
      duitku.ts
      http.ts
      signature.ts
      supabase-rest.ts
    duitku-create/
      index.ts
    duitku-callback/
      index.ts
    duitku-status/
      index.ts
  migrations/
    20261031000100_create_duitku_payment_tables.sql
docs/
  API.md
  SECURITY.md
.env.example
.gitignore
README.md
```

## Duitku API source of truth

This implementation follows the official Duitku POP documentation:

- Indonesian: https://docs.duitku.com/pop/id/
- English: https://docs.duitku.com/pop/en/

Create Invoice uses `POST /api/merchant/createInvoice` and request headers `x-duitku-timestamp`, `x-duitku-signature`, and `x-duitku-merchantcode`. The request signature is HMAC-SHA256 of `merchantCode + timestamp`, keyed by the merchant API key. Callback signature is HMAC-SHA256 of `merchantCode + amount + merchantOrderId`, keyed by the same API key.

Do not use the obsolete MD5 or legacy SHA256 signature examples.

## Local setup

1. Install the Supabase CLI.
2. Copy `.env.example` to your local secrets manager; never commit real credentials.
3. Configure the Edge Function secrets described in `docs/SECURITY.md`.
4. Review the SQL migration before applying it to a Supabase project.
5. Run local tests and Supabase CLI checks before deployment.

No project linking, migration application, secret upload, or deployment is performed as part of this repository initialization.

## Important payment rules

- Generate `merchantOrderId` on the trusted server and make it unique per order.
- Calculate the amount from trusted order data, never from a client-supplied total.
- Treat the Duitku HTTP callback as the payment notification channel.
- Never mark an order paid from a browser redirect or JavaScript callback.
- Validate callback merchant code, amount, order ID, and HMAC signature.
- Make callback processing idempotent and do not downgrade a successful payment.
- Keep the Duitku API key and Supabase service-role key server-side only.

See [API documentation](docs/API.md) and [security notes](docs/SECURITY.md).
