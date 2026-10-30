# Duitku POP API Compatibility Audit

- Repository: `gantuluu/duitku-supabase`
- Scope: Create Invoice request/response and HTTP Callback protocol
- Audit date: 2026-10-31
- Reference: Official Duitku POP API documentation (Indonesian)
- Result: **Protocol-level compatibility: PASS, with implementation hardening recommendations**

## 1. Official API contract checked

Source: https://docs.duitku.com/pop/id/

### Create Invoice

| Contract | Official documentation | Repository implementation | Result |
|---|---|---|---|
| HTTP method | POST | POST | PASS |
| Content type | application/json | application/json | PASS |
| Sandbox endpoint | https://api-sandbox.duitku.com/api/merchant/createInvoice | Same | PASS |
| Production endpoint | https://api-prod.duitku.com/api/merchant/createInvoice | Same | PASS |
| Timestamp | UNIX milliseconds | Date.now() milliseconds | PASS |
| Signature | HMAC-SHA256(merchantCode + timestamp, apiKey) | Same formula and algorithm | PASS |
| Merchant header | x-duitku-merchantcode | Same | PASS |
| Timestamp header | x-duitku-timestamp | Same | PASS |
| Signature header | x-duitku-signature | Same | PASS |
| Required request fields | paymentAmount, merchantOrderId, productDetails, email, callbackUrl, returnUrl | All supplied | PASS |
| Successful response | statusCode 00, reference, paymentUrl | Validates all three | PASS |

The implementation correctly uses HMAC-SHA256, not the obsolete legacy SHA256/MD5 examples.

### Documented field constraints

| Field | Duitku POP documentation | Current implementation |
|---|---:|---|
| merchantOrderId | string, max 50 | UUID (36 chars) |
| productDetails | string, max 255 | SQL constraint max 255 |
| email | string, max 255 | No explicit length/email-format validation |
| customerVaName | string, max 20 | Truncated to 20 characters |
| phoneNumber | string, max 50 | No explicit length validation |
| callbackUrl | string, max 255 | No explicit length validation |
| returnUrl | string, max 255 | No explicit length validation |
| paymentAmount | integer | Stored as bigint; no explicit positive/integer validation in Edge Function |

Optional `itemDetails` is not sent. If it is added in a future implementation, its item prices must reconcile with `paymentAmount` as documented by Duitku.

### HTTP Callback

| Contract | Official documentation | Repository implementation | Result |
|---|---|---|---|
| Method | POST | POST | PASS |
| Content type | application/x-www-form-urlencoded | Enforced and parsed with FormData | PASS |
| Required signature inputs | merchantCode + amount + merchantOrderId | Same concatenation | PASS |
| Signature algorithm | HMAC-SHA256 with API key | Same | PASS |
| Merchant validation | Verify merchant code | Exact comparison | PASS |
| Amount validation | Compare against stored payment | Numeric comparison | PASS |
| Success result | resultCode 00 | Maps 00 to paid | PASS |
| Acknowledgement | HTTP 200 required | Returns HTTP 200 plain-text OK | PASS |

The callback handler also logs the received payload and signature validation result. It does not trust browser redirect or JavaScript callback state.

## 2. Findings

### F-01 — Request field validation is incomplete

**Severity: Medium**

The Edge Function obtains core values from the database, which is the correct trust boundary, but some documented Duitku limits are not validated before sending the request. Invalid email formats, oversized phone numbers, or callback/return URLs longer than 255 characters may be rejected by Duitku.

Recommended hardening:
- Validate email format and maximum 255 characters.
- Validate phoneNumber maximum 50 characters when present.
- Validate callbackUrl and returnUrl maximum 255 characters.
- Validate paymentAmount is a positive safe integer before API submission.
- Keep productDetails maximum 255 and customerVaName maximum 20.

### F-02 — Callback result-code documentation contains an inconsistency

**Severity: Low**

The official POP page's callback parameter table describes `00` as success and `01` as failed, while its later API response-code table describes callback `00` as success and `02` as failed. The implementation treats only `00` as paid and every other result code as not paid, which is fail-closed. Confirm the exact failure result code with Duitku merchant support before adding more detailed failed/cancelled status mapping.

### F-03 — No live Sandbox verification

**Severity: Informational**

No merchant credentials were supplied and no Sandbox request was sent. The audit verifies source-level protocol alignment only. Runtime behavior, merchant-specific payment channel enablement, callback delivery, and real response variations remain unverified.

## 3. Conclusion

The repository's Create Invoice endpoint, authentication headers, HMAC-SHA256 formula, response fields, and HTTP Callback signature formula align with the official Duitku POP API reference inspected on 2026-10-31.

The integration is **not yet certified for production**. Address F-01, confirm F-02 with Duitku, then run a complete Sandbox test including successful payment, failed/expired payment, duplicate callback, and callback retry.

## 4. Official references

- Duitku POP API Reference (Indonesia): https://docs.duitku.com/pop/id/
- Duitku POP API Reference (English): https://docs.duitku.com/pop/en/
