# API Reference

All URLs below are relative to the Supabase Functions base URL:

`https://<project-ref>.supabase.co/functions/v1`

## 1. Create payment

`POST /duitku-create`

Requires a valid Supabase user JWT. The body accepts only an existing payment intent ID; amount, email, and product description are loaded from the trusted database row.

Request:

```json
{ "orderId": "UUID_FROM_DUITKU_PAYMENT_ORDERS" }
```

Success response:

```json
{
  "success": true,
  "data": {
    "merchantOrderId": "UUID",
    "reference": "DUITKU_REFERENCE",
    "paymentUrl": "https://...",
    "status": "pending"
  }
}
```

Before calling this endpoint, a trusted backend must create a row in `duitku_payment_orders`. Do not allow clients to insert or modify payment intent rows directly.

The Create Invoice adapter validates the Duitku request before sending it:
- `paymentAmount` must be a positive safe integer.
- `merchantOrderId` must be non-empty and at most 50 characters.
- `productDetails`, `email`, `callbackUrl`, and `returnUrl` must be non-empty and at most 255 characters.
- `email` must have a basic valid email format.
- `callbackUrl` and `returnUrl` must be valid HTTP or HTTPS URLs.
- Optional `customerVaName` must be non-empty and at most 20 characters; optional `phoneNumber` must be at most 50 characters.

Invalid values are rejected locally before any request is sent to Duitku. These checks do not change the endpoint request or response contract.

## 2. Duitku callback

`POST /duitku-callback`

Public endpoint called by Duitku. Content type must be `application/x-www-form-urlencoded`. The handler validates merchant code, amount, merchant order ID, and HMAC-SHA256 signature before changing payment state.

Callback result-code rules:
- `resultCode = "00"`: accepted as successful payment for all payment channels.
- `resultCode = "01"`: accepted as failed only when `paymentCode = "VC"` (Credit Card: Visa, Mastercard, or JCB).
- Missing, unknown, or unsupported result codes are rejected without changing payment or order status.
- A `01` callback from any payment channel other than `VC` is rejected without changing payment or order status.

The callback payment method code is saved in `duitku_payments.payment_method`. The callback `reference` must exactly match the non-empty Duitku invoice reference saved when the invoice was created; missing or mismatched references are rejected without changing payment state. The callback endpoint returns plain-text `OK` with HTTP 200 after successful processing.

## 3. Read payment status

`GET /duitku-status?orderId=<uuid>`

Requires a valid Supabase user JWT. The endpoint verifies order ownership before returning the payment record.

## Error format

```json
{ "success": false, "error": "Readable error message" }
```
