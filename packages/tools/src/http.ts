export const PROVIDER_FETCH_TIMEOUT_MS = 8000;

export function sanitizeProviderError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 240);
}

/**
 * Local workerd has returned an already-aborted `AbortSignal.timeout()` signal,
 * which fails Google Places fetches in ~10ms. Use a request-scoped controller.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = PROVIDER_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort);
  try {
    if (init.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    init.signal?.removeEventListener("abort", onAbort);
  }
}
