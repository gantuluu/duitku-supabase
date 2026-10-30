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
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return jsonResponse({ success: false, error: "Expected form-urlencoded callback" }, 415);
    }

    const form = await request.formData();
    const payload = Object.fromEntries(form.entries());
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

    await dbInsert("duitku_callback_logs", {
      merchant_order_id: merchantOrderId || null,
      duitku_reference: String(payload.reference ?? "") || null,
      signature_valid: signatureValid && merchantValid,
      payload,
    });

    if (!signatureValid || !merchantValid) {
      return jsonResponse({ success: false, error: "Invalid callback signature or merchant code" }, 401);
    }
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
      p_callback_payload: payload,
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
