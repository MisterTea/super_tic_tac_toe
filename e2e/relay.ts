import { WebSocketServer, WebSocket } from "ws";
import { verifyEvent, type Event } from "nostr-tools";
export async function localRelay() {
  const relay = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => relay.on("listening", r));
  const address = relay.address();
  if (!address || typeof address === "string") throw Error("Relay failed");
  const subscriptions = new Map<
      WebSocket,
      { id: string; filter: Record<string, unknown> }
    >(),
    events: Event[] = [];
  const matches = (e: Event, f: Record<string, unknown>) =>
    (!(f.kinds as number[])?.length ||
      (f.kinds as number[]).includes(e.kind)) &&
    (!(f["#t"] as string[])?.length ||
      e.tags.some((t) => t[0] === "t" && (f["#t"] as string[]).includes(t[1])));
  relay.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const [type, id, ...rest] = JSON.parse(raw.toString());
      if (type === "REQ") {
        subscriptions.set(ws, { id, filter: rest[0] });
        for (const e of events)
          if (matches(e, rest[0])) ws.send(JSON.stringify(["EVENT", id, e]));
        ws.send(JSON.stringify(["EOSE", id]));
      }
      if (type === "EVENT") {
        const e = id as Event;
        if (!verifyEvent(e)) {
          ws.send(JSON.stringify(["OK", e.id, false, "invalid"]));
          return;
        }
        events.push(e);
        ws.send(JSON.stringify(["OK", e.id, true, ""]));
        for (const [client, sub] of subscriptions)
          if (client.readyState === WebSocket.OPEN && matches(e, sub.filter))
            client.send(JSON.stringify(["EVENT", sub.id, e]));
      }
    });
    ws.on("close", () => subscriptions.delete(ws));
  });
  return {
    url: `ws://localhost:${address.port}`,
    events,
    close: async () => {
      for (const c of relay.clients) c.terminate();
      await new Promise<void>((r) => relay.close(() => r()));
    },
  };
}
