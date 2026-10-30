import { createDuitkuInvoice } from "../_shared/duitku.ts";
import { jsonResponse, requiredEnv } from "../_shared/http.ts";
import {
  dbInsert,
  dbPatch,
  dbSelect,
  getAuthenticatedUserId,
} from "../_shared/supabase-rest.ts";

type PaymentOrder = {
  id: string;
  user_id: string;
  amount: number;
  product_details: string;
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  payment_status: string;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const userId = await getAuthenticatedUserId(request);
    const body = await request.json().catch(() => null) as { orderId?: string } | null;
    if (!body?.orderId || !/^[0-9a-f-]{36}$/i.test(body.orderId)) {
      return jsonResponse({ success: false, error: "A valid orderId is required" }, 400);
    }

    const orderQuery = new URLSearchParams({
      select: "id,user_id,amount,product_details,customer_email,customer_name,customer_phone,payment_status",
      id: `eq.${body.orderId}`,
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const orders = await dbSelect<PaymentOrder>("duitku_payment_orders", orderQuery);
    const order = orders[0];
    if (!order) return jsonResponse({ success: false, error: "Payment order not found" }, 404);
    if (order.payment_status === "paid") {
      return jsonResponse({ success: false, error: "Order has already been paid" }, 409);
    }

    const existingQuery = new URLSearchParams({
      select: "merchant_order_id,payment_url,status",
      order_id: `eq.${order.id}`,
      limit: "1",
    });
    const existing = await dbSelect<Record<string, unknown>>("duitku_payments", existingQuery);
    if (existing[0]?.status === "pending" && existing[0]?.payment_url) {
      return jsonResponse({ success: true, data: existing[0] });
    }

    const merchantOrderId = crypto.randomUUID();
    await dbInsert("duitku_payments", {
      order_id: order.id,
      merchant_order_id: merchantOrderId,
      amount: order.amount,
      status: "pending",
    });

    try {
      const invoice = await createDuitkuInvoice({
        paymentAmount: order.amount,
        merchantOrderId,
        productDetails: order.product_details,
        email: order.customer_email,
        callbackUrl: requiredEnv("DUITKU_CALLBACK_URL"),
        returnUrl: requiredEnv("DUITKU_RETURN_URL"),
        ...(order.customer_name ? { customerVaName: order.customer_name.slice(0, 20) } : {}),
        ...(order.customer_phone ? { phoneNumber: order.customer_phone } : {}),
      });

      const updateQuery = new URLSearchParams({ merchant_order_id: `eq.${merchantOrderId}` });
      await dbPatch("duitku_payments", updateQuery, {
        duitku_reference: invoice.reference,
        payment_url: invoice.paymentUrl,
        updated_at: new Date().toISOString(),
      });
      const orderUpdate = new URLSearchParams({ id: `eq.${order.id}` });
      await dbPatch("duitku_payment_orders", orderUpdate, {
        payment_status: "pending",
        updated_at: new Date().toISOString(),
      });

      return jsonResponse({
        success: true,
        data: {
          merchantOrderId,
          reference: invoice.reference,
          paymentUrl: invoice.paymentUrl,
          status: "pending",
        },
      });
    } catch (error) {
      const failQuery = new URLSearchParams({ merchant_order_id: `eq.${merchantOrderId}` });
      await dbPatch("duitku_payments", failQuery, {
        status: "failed",
        result_message: error instanceof Error ? error.message : "Invoice creation failed",
        updated_at: new Date().toISOString(),
      });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
});
