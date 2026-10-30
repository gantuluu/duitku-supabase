# Security and Configuration

## Required Edge Function secrets

Set these as Supabase Edge Function secrets only when deploying:

- `DUITKU_MERCHANT_CODE`
- `DUITKU_API_KEY`
- `DUITKU_ENV` (`sandbox` or `production`)
- `DUITKU_CALLBACK_URL`
- `DUITKU_RETURN_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Never put Duitku credentials or the Supabase service-role key in a browser, mobile app, source control, or public build environment.

## Payment intent trust boundary

The client can only submit an order UUID to `duitku-create`. Amount and customer data are read from `duitku_payment_orders` using the service-role key after verifying the caller's Supabase Auth identity and row ownership.

Create payment-intent rows from a trusted backend. The migration intentionally creates no policies for `anon` or `authenticated`; do not grant direct client INSERT/UPDATE access to these tables.

## Callback validation

- Verify the exact HMAC-SHA256 formula from Duitku POP documentation.
- Verify merchant code and amount against the stored payment.
- Accept `resultCode = "00"` as successful payment for all channels.
- Accept `resultCode = "01"` as failed only for Credit Card channel `paymentCode = "VC"`.
- Reject missing, unknown, or channel-incompatible result codes before any payment-state mutation.
- Persist the callback `paymentCode` in `duitku_payments.payment_method` for reconciliation.
- Require the callback `reference` to exactly match the non-empty invoice reference stored in `duitku_payments.duitku_reference`; reject missing or mismatched references before state mutation.
- Keep callback logs for investigation.
- Never use browser redirects or JavaScript callbacks to mark an order as paid.
- Preserve paid as a terminal state; do not downgrade it on later callbacks.
- Apply the payment and parent-order status changes through the `apply_duitku_callback_status` database function. It locks the payment row and commits both changes in one transaction.
- The callback RPC is executable only by `service_role`; it uses `SECURITY INVOKER` and a fixed empty search path.
- Keep callback URL publicly reachable over HTTPS.

## Environment

Use sandbox until end-to-end callback testing is complete. Switch `DUITKU_ENV` to `production` only after merchant production credentials and callback URL are configured.

## Operational note

This initial repository does not connect to a Supabase project, set secrets, apply migrations, or deploy functions. Review the migration and function code before using it with a live payment system.
