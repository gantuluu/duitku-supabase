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


function validateDuitkuInvoiceRequest(payload: DuitkuInvoiceRequest): void {
  const requireString = (
    value: unknown,
    field: string,
    maxLength: number,
  ): void => {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > maxLength
    ) {
      throw new Error(`Invalid Duitku field: ${field}`);
    }
  };

  if (
    !Number.isSafeInteger(payload.paymentAmount) ||
    payload.paymentAmount <= 0
  ) {
    throw new Error("Invalid Duitku field: paymentAmount");
  }

  requireString(payload.merchantOrderId, "merchantOrderId", 50);
  requireString(payload.productDetails, "productDetails", 255);
  requireString(payload.email, "email", 255);
  requireString(payload.callbackUrl, "callbackUrl", 255);
  requireString(payload.returnUrl, "returnUrl", 255);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new Error("Invalid Duitku field: email");
  }

  for (const [field, value] of [
    ["callbackUrl", payload.callbackUrl],
    ["returnUrl", payload.returnUrl],
  ] as const) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      throw new Error(`Invalid Duitku field: ${field}`);
    }
  }

  if (
    payload.customerVaName !== undefined &&
    (typeof payload.customerVaName !== "string" ||
      payload.customerVaName.trim().length === 0 ||
      payload.customerVaName.length > 20)
  ) {
    throw new Error("Invalid Duitku field: customerVaName");
  }

  if (
    payload.phoneNumber !== undefined &&
    (typeof payload.phoneNumber !== "string" ||
      payload.phoneNumber.length > 50)
  ) {
    throw new Error("Invalid Duitku field: phoneNumber");
  }
}

export async function createDuitkuInvoice(
  payload: DuitkuInvoiceRequest,
): Promise<DuitkuInvoiceResponse> {
  validateDuitkuInvoiceRequest(payload);

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
