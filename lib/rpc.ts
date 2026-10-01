export class ConvexError extends Error {
  data: any;
  constructor(data: any) {
    super(typeof data === "string" ? data : JSON.stringify(data));
    this.name = "ConvexError";
    this.data = data;
  }
}
export const RPC_TIMEOUT_MS = 12000;
export async function callRpc(name: string, args: any = {}) {
  try {
    const res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
      credentials: "same-origin",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!res.ok)
      throw new ConvexError(
        data?.data || data?.error || "Request failed. Please try again.",
      );
    return data.result;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw new ConvexError(
        "The connection is taking too long. Please try again.",
      );
    throw error;
  }
}
