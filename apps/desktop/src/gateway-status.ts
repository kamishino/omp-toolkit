/** One-shot localhost gateway health probe for the tray menu label. */
export async function checkGatewayStatus(fetchFn: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchFn("http://127.0.0.1:4000/healthz", {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      return "Gateway: Active (:4000)";
    }
    return `Gateway: HTTP ${res.status}`;
  } catch {
    return "Gateway: Off";
  }
}
