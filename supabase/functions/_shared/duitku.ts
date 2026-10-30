import { duitkuBaseUrl, requiredEnv } from "./http.ts";
import { hmacSha256Hex } from "./signature.ts";

export type DuitkuInvoiceRequest = {
  paymentAmount: number;
  merchantOrderId: string;
  productDetails: string;
  email: string;
  callbackUrl: string;
  returnUrl: string;
  customerVaName?: string;
  phoneNumber?: string;
  paymentMethod?: string;
  expiryPeriod?: number;
};

export type DuitkuInvoiceResponse = {
  merchantCode: string;
  reference: string;
  paymentUrl: string;
  statusCode: string;
  statusMessage: string;
};

export async function createDuitkuInvoice(
  payload: DuitkuInvoiceRequest,
): Promise<DuitkuInvoiceResponse> {
  const merchantCode = requiredEnv("DUITKU_MERCHANT_CODE");
  const apiKey = requiredEnv("DUITKU_API_KEY");
  const timestamp = Date.now().toString();
  const signature = await hmacSha256Hex(merchantCode + timestamp, apiKey);

  const response = await fetch(
    `${duitkuBaseUrl()}/api/merchant/createInvoice`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-duitku-merchantcode": merchantCode,
        "x-duitku-timestamp": timestamp,
        "x-duitku-signature": signature,
      },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Duitku Create Invoice failed (${response.status}): ${JSON.stringify(result)}`);
  }
  const invoice = result as DuitkuInvoiceResponse;
  if (invoice.statusCode !== "00" || !invoice.reference || !invoice.paymentUrl) {
    throw new Error(invoice.statusMessage || "Duitku returned an invalid invoice response");
  }
  return invoice;
}
