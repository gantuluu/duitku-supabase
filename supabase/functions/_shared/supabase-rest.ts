import { requiredEnv } from "./http.ts";

function headers(extra: Record<string, string> = {}): Headers {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return new Headers({
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  });
}

function restUrl(path: string): string {
  return `${requiredEnv("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
}

export async function dbSelect<T>(
  table: string,
  query: URLSearchParams,
): Promise<T[]> {
  const response = await fetch(restUrl(`${table}?${query.toString()}`), {
    headers: headers(),
  });
  if (!response.ok) throw new Error(`Database select failed (${response.status})`);
  return await response.json() as T[];
}

export async function dbInsert<T>(
  table: string,
  value: Record<string, unknown>,
): Promise<T[]> {
  const response = await fetch(restUrl(table), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Database insert failed (${response.status})`);
  return await response.json() as T[];
}

export async function dbPatch<T>(
  table: string,
  query: URLSearchParams,
  value: Record<string, unknown>,
): Promise<T[]> {
  const response = await fetch(restUrl(`${table}?${query.toString()}`), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Database update failed (${response.status})`);
  return await response.json() as T[];
}

export async function dbRpc<T>(
  functionName: string,
  value: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(restUrl(`rpc/${encodeURIComponent(functionName)}`), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`Database RPC failed (${response.status})`);
  }
  return await response.json() as T;
}

export async function getAuthenticatedUserId(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new Error("Missing user authorization");

  const response = await fetch(
    `${requiredEnv("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/user`,
    {
      headers: {
        apikey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
        authorization,
      },
    },
  );
  if (!response.ok) throw new Error("Unauthorized");
  const user = await response.json() as { id?: string };
  if (!user.id) throw new Error("Unauthorized");
  return user.id;
}
