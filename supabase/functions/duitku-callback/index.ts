import { constantTimeEqual, hmacSha256Hex } from "../_shared/signature.ts";
import { jsonResponse, requiredEnv } from "../_shared/http.ts";
import { dbInsert, dbPatch, dbSelect } from "../_shared/supabase-rest.ts";

type Payment = {
  id: string;
  order_id: string;
  amount: number;
  status: string;
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

    const query = new URLSearchParams({
      select: "id,order_id,amount,status",
      merchant_order_id: `eq.${merchantOrderId}`,
      limit: "1",
    });
    const rows = await dbSelect<Payment>("duitku_payments", query);
    const payment = rows[0];
    if (!payment) return jsonResponse({ success: false, error: "Payment not found" }, 404);
    if (Number(amount) !== Number(payment.amount)) {
      return jsonResponse({ success: false, error: "Callback amount mismatch" }, 400);
    }

    // A paid transaction is terminal; never downgrade it from a later callback.
    if (payment.status !== "paid") {
      const resultCode = String(payload.resultCode ?? "");
      const nextStatus = resultCode === "00" ? "paid" : "failed";
      const paymentUpdate = new URLSearchParams({
        merchant_order_id: `eq.${merchantOrderId}`,
        status: "neq.paid",
      });
      await dbPatch("duitku_payments", paymentUpdate, {
        status: nextStatus,
        result_code: resultCode,
        result_message: String(payload.resultMessage ?? ""),
        callback_payload: payload,
        duitku_reference: String(payload.reference ?? "") || null,
        paid_at: nextStatus === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });

      const orderUpdate = new URLSearchParams({ id: `eq.${payment.order_id}` });
      await dbPatch("duitku_payment_orders", orderUpdate, {
        payment_status: nextStatus,
        updated_at: new Date().toISOString(),
      });
    }

    return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
  } catch (_error) {
    // Duitku retries callbacks when it does not receive HTTP 200.
    return jsonResponse({ success: false, error: "Callback processing failed" }, 500);
  }
});
