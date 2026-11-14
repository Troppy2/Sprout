/** `ping` round trip: proves stdout, bridge, service worker and dispatcher agree. */
export function ping(args: unknown): string {
  if (typeof args === "object" && args !== null) {
    const message = (args as Record<string, unknown>).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "pong";
}
