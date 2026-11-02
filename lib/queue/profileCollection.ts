import type { Channel } from "amqplib";
import { getChannel } from "@/lib/rabbitmq";
import { QUEUES, type QueueTag } from "./config";
import type { CardData } from "@/types/card";

export type ProfileCollectionTaskPayload = {
  tag: QueueTag;
  taskId?: string;
  contactId?: string;
  contact: CardData;
  timestamp: number;
};

export type BulkPublishResult = {
  queued: number;
  failed: number;
};

// How long a bulk publish waits for the channel's write buffer to empty before
// giving up on the remaining messages.
const DRAIN_TIMEOUT_MS = 10_000;

// Queues already declared on each channel. assertQueue is a broker round trip,
// so declaring once per channel instead of once per message is what lets a
// bulk publish of thousands of tasks finish in seconds. Keyed by channel so a
// reconnect (new channel) declares again.
const declaredQueues = new WeakMap<Channel, Set<string>>();

async function ensureQueue(ch: Channel, queue: string): Promise<void> {
  let declared = declaredQueues.get(ch);
  if (!declared) {
    declared = new Set();
    declaredQueues.set(ch, declared);
  }
  if (declared.has(queue)) return;
  await ch.assertQueue(queue, { durable: true });
  declared.add(queue);
}

/**
 * Resolve once the channel's write buffer has drained. Resolves false if the
 * channel closes or errors first, or the wait times out.
 */
function waitForDrain(ch: Channel): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      ch.off("drain", onDrain);
      ch.off("close", onFail);
      ch.off("error", onFail);
      resolve(ok);
    };
    const onDrain = () => finish(true);
    const onFail = () => finish(false);
    const timer = setTimeout(() => finish(false), DRAIN_TIMEOUT_MS);
    ch.once("drain", onDrain);
    ch.once("close", onFail);
    ch.once("error", onFail);
  });
}

/** The wire body: rawNotes is never sent to the worker. */
function messageBody(payload: ProfileCollectionTaskPayload): Buffer {
  const { rawNotes: _rawNotes, ...leanContact } = payload.contact;
  return Buffer.from(JSON.stringify({ ...payload, contact: leanContact }));
}

export async function publishProfileCollectionTask(
  payload: ProfileCollectionTaskPayload,
): Promise<boolean> {
  const queue = QUEUES.PROFILE_COLLECTION;
  const ch = await getChannel();
  if (!ch) {
    console.warn("[RabbitMQ] No channel — skipping publish");
    return false;
  }

  try {
    await ensureQueue(ch, queue);
    const body = messageBody(payload);
    const taskId = payload.taskId ?? "-";

    console.log(
      `[RabbitMQ] Sending to queue=${queue} tag=${payload.tag} taskId=${taskId} contactId=${payload.contactId ?? "-"}`
    );

    // Like stream.write, `false` means "buffer full, wait for drain" — the
    // message itself has still been accepted for sending.
    const flushed = ch.sendToQueue(queue, body, { persistent: true });
    if (!flushed) {
      console.warn(`[RabbitMQ] Write buffer full after taskId=${taskId}; message is buffered`);
    }
    console.log(`[RabbitMQ] Published taskId=${taskId} (${body.length} bytes) to ${queue}`);
    return true;
  } catch (err) {
    console.error("[RabbitMQ] Failed to publish task:", err);
    return false;
  }
}

/**
 * Publish many tasks over one channel with a single queue declaration,
 * honouring backpressure. Logs one summary line instead of one per task.
 */
export async function publishProfileCollectionTasks(
  payloads: ProfileCollectionTaskPayload[],
): Promise<BulkPublishResult> {
  if (payloads.length === 0) return { queued: 0, failed: 0 };

  const queue = QUEUES.PROFILE_COLLECTION;
  const ch = await getChannel();
  if (!ch) {
    console.warn(`[RabbitMQ] No channel — skipping bulk publish of ${payloads.length} tasks`);
    return { queued: 0, failed: payloads.length };
  }

  try {
    await ensureQueue(ch, queue);
  } catch (err) {
    console.error("[RabbitMQ] Failed to declare queue for bulk publish:", err);
    return { queued: 0, failed: payloads.length };
  }

  let queued = 0;
  for (const payload of payloads) {
    try {
      const flushed = ch.sendToQueue(queue, messageBody(payload), { persistent: true });
      queued += 1;
      if (!flushed && !(await waitForDrain(ch))) {
        console.error(
          `[RabbitMQ] Channel did not drain; stopped after ${queued} of ${payloads.length} tasks`
        );
        break;
      }
    } catch (err) {
      console.error(
        `[RabbitMQ] Bulk publish stopped after ${queued} of ${payloads.length} tasks:`,
        err
      );
      break;
    }
  }

  const failed = payloads.length - queued;
  console.log(`[RabbitMQ] Bulk published ${queued}/${payloads.length} tasks to ${queue}`);
  return { queued, failed };
}
