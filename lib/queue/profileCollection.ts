import { getChannel } from "@/lib/rabbitmq";
import { QUEUES, type ProfileTag } from "./config";
import type { CardData } from "@/types/card";

export type ProfileCollectionTaskPayload = {
  tag: ProfileTag;
  taskId?: string;
  contactId?: string;
  contact: CardData;
  timestamp: number;
};

async function publishToQueue(
  queue: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const ch = await getChannel();
  if (!ch) {
    console.warn("[RabbitMQ] No channel — skipping publish");
    return false;
  }

  try {
    await ch.assertQueue(queue, { durable: true });
    const body = Buffer.from(JSON.stringify(payload));
    const tag = payload.tag as string;
    const contactId = payload.contactId as string | undefined;
    const taskId = payload.taskId as string | undefined;

    console.log(
      `[RabbitMQ] Sending to queue=${queue} tag=${tag} taskId=${taskId ?? "-"} contactId=${contactId ?? "-"}`
    );

    const sent = ch.sendToQueue(
      queue,
      body,
      { persistent: true },
    );
    if (!sent) {
      console.warn("[RabbitMQ] Message not sent (backpressure)");
    } else {
      console.log(
        `[RabbitMQ] Published taskId=${taskId ?? "-"} (${body.length} bytes) to ${queue}`
      );
    }
    return sent;
  } catch (err) {
    console.error("[RabbitMQ] Failed to publish task:", err);
    return false;
  }
}

export async function publishProfileCollectionTask(
  payload: ProfileCollectionTaskPayload,
): Promise<boolean> {
  return publishToQueue(QUEUES.PROFILE_COLLECTION, payload);
}
