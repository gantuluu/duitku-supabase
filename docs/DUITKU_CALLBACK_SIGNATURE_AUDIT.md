# Audit 2 — Duitku Callback & Signature Security

**Repository:** `gantuluu/duitku-supabase`  
**Audit date:** 2026-10-31  
**Scope:** `duitku-callback`, shared HMAC implementation, callback persistence, and relevant database constraints.  
**Mode:** Read-only technical audit. No runtime credentials, Supabase project connection, migration execution, or deployment were used.

## Executive summary

The callback uses the documented Duitku POP HMAC-SHA256 formula:

`HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)`

It also checks the configured merchant code, compares the callback amount with the stored payment amount, uses a constant-time character comparison for equal-length signatures, and does not require a user JWT on the public provider callback endpoint. The signature algorithm is consistent with the current Duitku POP documentation.

**Result: PARTIAL PASS — cryptographic formula is correct, but callback state handling and input/resource controls require remediation before production use.**

## Findings

### C-01 — High: order status can diverge from payment status during concurrent callbacks

**Location:** `supabase/functions/duitku-callback/index.ts`

The handler conditionally updates `duitku_payments` with `status=neq.paid`, but ignores the returned rows. It then updates `duitku_payment_orders` unconditionally to the status calculated from the callback.

Two callbacks can read the same pending payment concurrently. If the success callback changes the payment row to `paid` first, a concurrent failure callback's conditional payment update will affect zero rows, but its order update can still set the parent order to `failed`. The two tables can therefore disagree.

**Impact:** Application logic that trusts `duitku_payment_orders.payment_status` may treat a paid order as failed, or otherwise make inconsistent fulfillment decisions.

**Recommendation:** Move callback verification and both status updates into one database transaction (for example, a narrowly scoped SQL function/RPC). Lock the payment row, enforce an explicit state transition policy, and update the payment and order atomically. Do not update the parent order unless the corresponding payment transition was actually accepted.

### C-02 — High: unknown or missing resultCode is treated as a confirmed failure

**Location:** `supabase/functions/duitku-callback/index.ts`

The current expression maps every value other than `"00"` to `"failed"`. That includes missing, malformed, or future/unknown result codes. The current POP documentation identifies `00` as success and `01` as failed.

**Impact:** An invalid or unexpected callback can change a pending payment to failed instead of being rejected for investigation. It also makes future provider status changes unsafe by default.

**Recommendation:** Validate `resultCode` explicitly against the documented values before changing state. Accept `00` as success and `01` as failed; reject missing or unknown values without changing payment state. Confirm any additional status codes with Duitku before supporting them.

### C-03 — Medium: provider reference is not checked against the invoice reference stored at creation

**Location:** `supabase/functions/duitku-callback/index.ts`

The callback's `reference` is stored, but the handler does not compare it with the existing `duitku_payments.duitku_reference`.

**Impact:** The callback is already protected by HMAC, merchant code, merchant order ID, and amount checks. However, not checking the provider reference removes an additional consistency check tying the callback to the invoice response originally recorded by this application.

**Recommendation:** When an invoice reference is present in the database, require the callback reference to match it before applying a state transition. Handle missing reference only according to a confirmed Duitku callback contract.

### C-04 — Medium: callback request body and field count are not bounded

**Location:** `supabase/functions/duitku-callback/index.ts`

The handler calls `request.formData()` without checking the body size or limiting the number and length of fields. It also converts all form entries into an object without explicitly rejecting duplicate field names.

**Impact:** The public endpoint can be exposed to unnecessarily large form submissions and excess parsing/database work. Duplicate fields can create ambiguous parsing behavior.

**Recommendation:** Enforce a reasonable request-body size limit before parsing; reject duplicate security-relevant fields; validate required field lengths and formats; and only retain the callback fields the application actually needs.

### C-05 — Medium: raw callback payload is persisted without minimization

**Location:** `supabase/functions/duitku-callback/index.ts`; `duitku_callback_logs.payload`

The entire parsed callback payload is written to the database before signature and merchant validation. The POP callback schema can contain additional customer/payment metadata, and the current implementation does not redact or minimize it.

**Impact:** Untrusted requests can create log volume, and customer or payment-related metadata may be retained even when it is not required for reconciliation. This increases privacy and data-retention exposure.

**Recommendation:** Persist only an allowlist of fields needed for security investigation and reconciliation. Redact sensitive/optional values, apply retention rules, and consider whether invalid requests need full database logging at all. Keep audit logging failures from silently causing inconsistent payment processing; define a deliberate retry/failure policy.

### C-06 — Low: constant-time comparison returns early when signature lengths differ

**Location:** `supabase/functions/_shared/signature.ts`

`constantTimeEqual` returns immediately if the strings have different lengths. For valid HMAC-SHA256 hex digests, the expected length is fixed at 64 characters, so this is not a practical timing weakness for the current use case. However, signature format/length validation should be explicit.

**Recommendation:** Require a 64-character hexadecimal callback signature before comparison. Keep the comparison for equal-length digests.

## Controls that passed review

- Callback signature formula matches Duitku POP documentation.
- HMAC-SHA256 is implemented with Web Crypto; no obsolete MD5 callback formula is used.
- Configured merchant code is compared with the callback merchant code.
- Callback amount is checked against the stored payment amount.
- The public callback endpoint is appropriate for a provider-to-server notification and does not rely on browser redirect/JavaScript callback state.
- The code avoids downgrading a payment row already observed as `paid` in the ordinary sequential path.
- Callback logs, payments, and orders have RLS enabled and no client-facing policies in the migration.

## Remediation status

- **C-01 — Implemented in source:** callback state changes now run through `public.apply_duitku_callback_status`, a PostgreSQL function that locks the payment row with `FOR UPDATE` and updates payment and parent order in one transaction. The RPC is restricted to `service_role` and invoked from the callback Edge Function.
- **Verification limitation:** source files were fetched again after commit, but the migration was not applied to a Supabase project and no concurrent callback/database integration test was run. Treat C-01 as implemented in GitHub source, pending runtime verification.

## Remediation order

1. **C-01:** Make payment and order status updates atomic and race-safe.
2. **C-02:** Strictly validate result codes before state changes.
3. **C-03:** Verify the callback provider reference against the stored invoice reference.
4. **C-04:** Bound request size, field lengths, and duplicate fields.
5. **C-05:** Minimize and redact callback logs; define logging failure behavior.
6. **C-06:** Enforce signature format and length before constant-time comparison.

## Sources

- Duitku POP API reference (Indonesia): https://docs.duitku.com/pop/id/
- Duitku POP API reference (English): https://docs.duitku.com/pop/en/

The Duitku POP documentation describes the callback as HTTP POST with `application/x-www-form-urlencoded`, defines the HMAC-SHA256 callback signature as `merchantCode + amount + merchantOrderId`, identifies `00` as success and `01` as failed, and states that Duitku retries when it does not receive HTTP 200.

## Audit limitations

This was a source-code review of the repository's current `main` branch. No adversarial HTTP tests, concurrency tests, Deno test suite, Sandbox callback, or production transaction was executed. Findings describe code-level risks and should be revalidated with automated tests after remediation.
