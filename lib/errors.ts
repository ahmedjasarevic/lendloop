/** ConvexError carries a structured `data` payload; surface its message to the UI. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  }
  if (error instanceof Error && error.message) {
    // Convex prefixes uncaught server errors; keep them readable but honest.
    return error.message.replace(/^\[CONVEX[^\]]*\]\s*/, "");
  }
  return "Something went wrong. Please try again.";
}
