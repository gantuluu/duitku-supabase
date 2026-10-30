import { constantTimeEqual, hmacSha256Hex } from "../_shared/signature.ts";
import { jsonResponse, requiredEnv } from "../_shared/http.ts";
import { dbInsert, dbRpc } from "../_shared/supabase-rest.ts";

type CallbackApplyResult = {
  outcome: "updated" | "already_paid" | "not_found" | "amount_mismatch" | "reference_mismatch";
  status?: string;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\\/x-www-form-urlencoded(?:\\s*;|$)/i.test(contentType)) {
      return jsonResponse({ success: false, error: "Expected form-urlencoded callback" }, 415);
    }

    // Bound the stream before buffering or parsing attacker-controlled input.
    const MAX_BODY_BYTES = 16 * 1024;
    const MAX_FIELDS = 32;
    const MAX_FIELD_NAME_LENGTH = 64;
    const MAX_FIELD_VALUE_LENGTH = 2048;
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && (!/^\\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
      return jsonResponse({ success: false, error: "Callback body too large" }, 413);
    }
    if (!request.body) {
      return jsonResponse({ success: false, error: "Callback body is empty" }, 400);
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return jsonResponse({ success: false, error: "Callback body too large" }, 413);
      }
      chunks.push(value);
    }

    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let encodedBody: string;
    try {
      encodedBody = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    } catch {
      return jsonResponse({ success: false, error: "Callback body is not valid UTF-8" }, 400);
    }

    const form = new URLSearchParams(encodedBody);
    const entries = [...form.entries()];
    if (entries.length === 0 || entries.length > MAX_FIELDS) {
      return jsonResponse({ success: false, error: "Invalid callback field count" }, 400);
    }

    const payload: Record<string, string> = Object.create(null);
    for (const [key, value] of entries) {
      if (
        key.length === 0 ||
        key.length > MAX_FIELD_NAME_LENGTH ||
        value.length > MAX_FIELD_VALUE_LENGTH
      ) {
        return jsonResponse({ success: false, error: "Callback field exceeds allowed length" }, 400);
      }
      if (Object.hasOwn(payload, key)) {
        return jsonResponse({ success: false, error: "Duplicate callback field" }, 400);
      }
      payload[key] = value;
    }

    const fieldLimits: Record<string, number> = {
      merchantCode: 50,
      amount: 20,
      merchantOrderId: 50,
      signature: 64,
      resultCode: 2,
      resultMessage: 255,
      paymentCode: 20,
      reference: 100,
    };
    for (const [key, maxLength] of Object.entries(fieldLimits)) {
      const value = payload[key];
      if (value !== undefined && value.length > maxLength) {
        return jsonResponse({ success: false, error: "Invalid callback field length" }, 400);
      }
    }
    const merchantCode = String(payload.merchantCode ?? "");
    const amount = String(payload.amount ?? "");
    const merchantOrderId = String(payload.merchantOrderId ?? "");
    const signature = String(payload.signature ?? "");
    const apiKey = requiredEnv("DUITKU_API_KEY");
    const expectedMerchantCode = requiredEnv("DUITKU_MERCHANT_CODE");

    const expectedSignature = await hmacSha256Hex(
      merchantCode + amount + merchantOrderId,
      apiKey,
    );
    const signatureValid = constantTimeEqual(signature.toLowerCase(), expectedSignature);
    const merchantValid = merchantCode === expectedMerchantCode;

    // Persist only the small allowlist needed for reconciliation. Never store
    // the submitted signature or arbitrary provider/customer metadata.
    const auditPayload = {
      merchantCode,
      amount,
      merchantOrderId,
      reference: String(payload.reference ?? ""),
      resultCode: String(payload.resultCode ?? ""),
      paymentCode: String(payload.paymentCode ?? ""),
    };

    if (!signatureValid || !merchantValid) {
      // Invalid callbacks are logged best-effort; logging failure must not
      // change the authentication result returned to the untrusted sender.
      try {
        await dbInsert("duitku_callback_logs", {
          merchant_order_id: merchantOrderId || null,
          duitku_reference: auditPayload.reference || null,
          signature_valid: false,
          payload: auditPayload,
        });
      } catch {
        // Do not expose database/logging details to an unauthenticated caller.
      }
      return jsonResponse({ success: false, error: "Invalid callback signature or merchant code" }, 401);
    }

    // For authenticated callbacks, audit persistence is required before any
    // payment-state mutation. Failure returns 500 so Duitku can retry safely.
    await dbInsert("duitku_callback_logs", {
      merchant_order_id: merchantOrderId || null,
      duitku_reference: auditPayload.reference || null,
      signature_valid: true,
      payload: auditPayload,
    });
    if (!merchantOrderId || !/^\d+$/.test(amount)) {
      return jsonResponse({ success: false, error: "Invalid callback fields" }, 400);
    }

    const resultCode = String(payload.resultCode ?? "").trim();
    const paymentCode = String(payload.paymentCode ?? "").trim().toUpperCase();
    let nextStatus: "paid" | "failed";

    if (resultCode === "00") {
      nextStatus = "paid";
    } else if (resultCode === "01" && paymentCode === "VC") {
      // Duitku resultCode 01 is supported for Credit Card (VC) only.
      nextStatus = "failed";
    } else {
      // Unknown/missing result codes, and 01 from non-credit-card channels,
      // must never mutate payment or order state.
      return jsonResponse({ success: false, error: "Unsupported callback result code or payment channel" }, 400);
    }

    const result = await dbRpc<CallbackApplyResult>("apply_duitku_callback_status", {
      p_merchant_order_id: merchantOrderId,
      p_amount: amount,
      p_next_status: nextStatus,
      p_result_code: resultCode,
      p_result_message: String(payload.resultMessage ?? ""),
      p_callback_payload: auditPayload,
      p_duitku_reference: String(payload.reference ?? ""),
    });

    if (result.outcome === "not_found") {
      return jsonResponse({ success: false, error: "Payment not found" }, 404);
    }
    if (result.outcome === "amount_mismatch") {
      return jsonResponse({ success: false, error: "Callback amount mismatch" }, 400);
    }
    if (result.outcome === "reference_mismatch") {
      return jsonResponse({ success: false, error: "Callback reference mismatch" }, 400);
    }
    if (result.outcome !== "updated" && result.outcome !== "already_paid") {
      throw new Error("Unexpected callback transaction result");
    }

    return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
  } catch (_error) {
    // Duitku retries callbacks when it does not receive HTTP 200.
    return jsonResponse({ success: false, error: "Callback processing failed" }, 500);
  }
});
