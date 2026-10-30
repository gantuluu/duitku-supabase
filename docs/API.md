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

## 2. Duitku callback

`POST /duitku-callback`

Public endpoint called by Duitku. Content type must be `application/x-www-form-urlencoded`. The handler validates merchant code, amount, merchant order ID, and HMAC-SHA256 signature before changing payment state.

Duitku callback success is represented by `resultCode = "00"`. The endpoint returns plain-text `OK` with HTTP 200 after successful processing.

## 3. Read payment status

`GET /duitku-status?orderId=<uuid>`

Requires a valid Supabase user JWT. The endpoint verifies order ownership before returning the payment record.

## Error format

```json
{ "success": false, "error": "Readable error message" }
```
