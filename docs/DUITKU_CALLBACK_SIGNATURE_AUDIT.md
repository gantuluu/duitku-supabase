# Audit 2 — Duitku Callback & Signature Security

**Repository:** `gantuluu/duitku-supabase`  
**Audit date:** 2026-10-31  
**Scope:** `duitku-callback`, shared HMAC implementation, callback persistence, and relevant database constraints.  
**Mode:** Source-code audit and remediation tracking. No runtime credentials, Supabase project connection, migration execution, or deployment were used.

## Executive summary

The callback uses the documented Duitku POP HMAC-SHA256 formula:

`HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)`

It also checks the configured merchant code, compares the callback amount with the stored payment amount, uses a constant-time character comparison for equal-length signatures, and does not require a user JWT on the public provider callback endpoint. The signature algorithm is consistent with the current Duitku POP documentation.

**Result: PARTIAL PASS — cryptographic formula is correct; callback state handling and input/resource controls are being remediated.**

## Findings

### C-01 — High: order status can diverge from payment status during concurrent callbacks

**Status: Implemented in GitHub source; runtime verification pending.**

Payment and parent-order status changes now run through `public.apply_duitku_callback_status`. The function locks the payment row with `FOR UPDATE`, checks the stored amount, preserves `paid` as a terminal state, and updates both rows in one database transaction. The RPC is restricted to `service_role` and invoked from the callback Edge Function.

### C-02 — High: unknown or missing resultCode is treated as a confirmed failure

**Original risk:** The old handler mapped every value other than `"00"` to `"failed"`, including missing, malformed, or unknown codes.

**Status: Implemented in GitHub source; runtime verification pending.**

The callback now applies the documented POP channel-specific rule:
- `00` is accepted as success for all channels.
- `01` is accepted as failure only for Credit Card, identified by callback `paymentCode = "VC"`.
- Missing/unknown result codes and `01` on non-VC channels are rejected before the payment-state RPC is called.

The database RPC independently enforces the same result-code/channel mapping and stores the callback payment code in `duitku_payments.payment_method`.

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
- Callback payment channel is read from Duitku's `paymentCode` field; Credit Card uses code `VC`.
- The public callback endpoint is appropriate for a provider-to-server notification and does not rely on browser redirect/JavaScript callback state.
- The code avoids downgrading a payment row already observed as `paid` in the ordinary sequential path.
- Callback logs, payments, and orders have RLS enabled and no client-facing policies in the migration.

## Remediation status

- **C-01 — Implemented in source:** callback state changes run through `public.apply_duitku_callback_status`, a PostgreSQL function that locks the payment row with `FOR UPDATE` and updates payment and parent order in one transaction. The RPC is restricted to `service_role` and invoked from the callback Edge Function.
- **C-02 — Implemented in source:** explicit result-code and payment-channel validation is performed in the Edge Function and independently enforced by the database RPC. `paymentCode = "VC"` is recorded in `duitku_payments.payment_method`.
- **Verification limitation:** source files were fetched again after commit, but migrations were not applied to a Supabase project and no Deno, database integration, or callback concurrency tests were run. Treat C-01 and C-02 as implemented in GitHub source, pending runtime verification.

## Remediation order

1. **C-01:** Make payment and order status updates atomic and race-safe. — Implemented in source.
2. **C-02:** Strictly validate result codes before state changes. — Implemented in source.
3. **C-03:** Verify the callback provider reference against the stored invoice reference.
4. **C-04:** Bound request size, field lengths, and duplicate fields.
5. **C-05:** Minimize and redact callback logs; define logging failure behavior.
6. **C-06:** Enforce signature format and length before constant-time comparison.

## Sources

- Duitku POP API reference (Indonesia): https://docs.duitku.com/pop/id/
- Duitku POP API reference (English): https://docs.duitku.com/pop/en/

The current POP reference identifies `00` as success and `01` as failed, includes `paymentCode` in the HTTP callback fields, and identifies `VC` as the Credit Card payment method (Visa/Mastercard/JCB). The project rule applied here is that `01` is accepted only for that Credit Card channel; `00` is accepted for all channels.

## Audit limitations

This was a source-code review of the repository's current `main` branch. No adversarial HTTP tests, concurrency tests, Deno test suite, Sandbox callback, or production transaction was executed. Findings describe code-level risks and should be revalidated with automated tests after remediation.
