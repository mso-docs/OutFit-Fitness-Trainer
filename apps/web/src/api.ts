export class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}
let token = sessionStorage.getItem("outfit-access-token") ?? "";
export function setToken(value: string) {
  token = value;
  sessionStorage.setItem("outfit-access-token", value);
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  if (import.meta.env.MODE === "pages") {
    const { browserAPI } = await import("./browser-api");
    return browserAPI<T>(path, method, body, key);
  }
  const res = await fetch("/api/v1" + path, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status === 204) return undefined as T;
  const result = await res.json();
  if (!res.ok)
    throw new APIError(
      result.error?.code ?? "ERROR",
      result.error?.message ?? "Could not connect to OutFit.",
      result.error?.fieldErrors,
    );
  return result.data;
}

export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const result: { items: T[]; nextCursor: string | null } = await api(
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + cursor : ""),
    );
    items.push(...result.items);
    cursor = result.nextCursor;
  } while (cursor);
  return items;
}
