import { Server } from "@hocuspocus/server";
import { createRealtimeConfiguration } from "../lib/realtime/server";

const port = Number(process.env.REALTIME_PORT || 1234);
const server = new Server({
  ...createRealtimeConfiguration(),
  port,
  address: "127.0.0.1",
  quiet: true,
  websocketOptions: { maxPayload: 1024 * 1024 },
});

try {
  await server.listen();
  console.log(`Realtime server ready on ws://127.0.0.1:${port}`);
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  if (code === "EADDRINUSE") {
    console.error(
      `Realtime port ${port} is already in use. Stop the existing server or change REALTIME_PORT.`,
    );
  } else {
    console.error("Realtime server failed to start.");
  }
  process.exit(1);
}

async function stop() {
  await server.destroy();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
