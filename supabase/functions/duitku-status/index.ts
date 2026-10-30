import { jsonResponse } from "../_shared/http.ts";
import { dbSelect, getAuthenticatedUserId } from "../_shared/supabase-rest.ts";

type PaymentOrder = { id: string; payment_status: string };
type Payment = {
  merchant_order_id: string;
  duitku_reference: string | null;
  payment_url: string | null;
  amount: number;
  status: string;
  result_code: string | null;
  paid_at: string | null;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const userId = await getAuthenticatedUserId(request);
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
      return jsonResponse({ success: false, error: "A valid orderId is required" }, 400);
    }

    const orderQuery = new URLSearchParams({
      select: "id,payment_status",
      id: `eq.${orderId}`,
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const orders = await dbSelect<PaymentOrder>("duitku_payment_orders", orderQuery);
    if (!orders[0]) return jsonResponse({ success: false, error: "Order not found" }, 404);

    const paymentQuery = new URLSearchParams({
      select: "merchant_order_id,duitku_reference,payment_url,amount,status,result_code,paid_at",
      order_id: `eq.${orderId}`,
      limit: "1",
    });
    const payments = await dbSelect<Payment>("duitku_payments", paymentQuery);
    return jsonResponse({
      success: true,
      data: payments[0] ?? null,
      orderStatus: orders[0].payment_status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ success: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
