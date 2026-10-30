export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function duitkuBaseUrl(): string {
  const environment = Deno.env.get("DUITKU_ENV") ?? "sandbox";
  if (environment === "sandbox") return "https://api-sandbox.duitku.com";
  if (environment === "production") return "https://api-prod.duitku.com";
  throw new Error("DUITKU_ENV must be either sandbox or production");
}
