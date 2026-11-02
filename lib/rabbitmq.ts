import amqplib, { type Channel, type ChannelModel } from "amqplib";

let model: ChannelModel | null = null;
let channel: Channel | null = null;

// Give up on an unreachable broker quickly. Without this, a broker the server
// cannot route to (e.g. a LAN address from Vercel) hangs until the platform
// kills the function, and the client sees "An unexpected response was received
// from the server".
const CONNECT_TIMEOUT_MS = 10_000;

/** Host only: the URL carries the broker password, which must not reach logs. */
function brokerHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable RABBITMQ_URL)";
  }
}

async function getModel(): Promise<ChannelModel | null> {
  const url = process.env.RABBITMQ_URL;
  if (!url) return null;

  if (model) return model;

  console.log("[RabbitMQ] Connecting to:", brokerHost(url));
  try {
    model = await amqplib.connect(url, { timeout: CONNECT_TIMEOUT_MS });
    model.on("error", (err: Error) => {
      console.error("[RabbitMQ] Connection error:", err);
      model = null;
      channel = null;
    });
    model.on("close", () => {
      console.log("[RabbitMQ] Connection closed");
      model = null;
      channel = null;
    });
    return model;
  } catch (err) {
    console.error("[RabbitMQ] Failed to connect:", err);
    return null;
  }
}

export async function getChannel(): Promise<Channel | null> {
  if (channel) return channel;

  const m = await getModel();
  if (!m) return null;

  try {
    channel = await m.createChannel();
    channel.on("error", (err: Error) => {
      console.error("[RabbitMQ] Channel error:", err);
      channel = null;
    });
    channel.on("close", () => {
      console.log("[RabbitMQ] Channel closed");
      channel = null;
    });
    return channel;
  } catch (err) {
    console.error("[RabbitMQ] Failed to create channel:", err);
    return null;
  }
}

export async function closeConnection(): Promise<void> {
  try {
    await channel?.close();
    await model?.close();
  } catch {
    // ignore cleanup errors
  } finally {
    channel = null;
    model = null;
  }
}
