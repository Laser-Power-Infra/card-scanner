import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChannel } from "@/lib/rabbitmq";
import type * as ProfileCollection from "@/lib/queue/profileCollection";

// tests/setup.ts mocks this module for every other test; exercise the real one.
const { publishProfileCollectionTasks, publishProfileCollectionTask } =
  await vi.importActual<typeof ProfileCollection>("@/lib/queue/profileCollection");

class FakeChannel extends EventEmitter {
  assertQueue = vi.fn(async () => ({}));
  sent: Buffer[] = [];
  // Per-call return values for sendToQueue; defaults to true (buffer not full).
  flushResults: boolean[] = [];
  sendToQueue = vi.fn((_queue: string, body: Buffer) => {
    this.sent.push(body);
    return this.flushResults.shift() ?? true;
  });
}

function task(id: string): ProfileCollection.ProfileCollectionTaskPayload {
  return {
    tag: "research",
    taskId: `t-${id}`,
    contactId: id,
    timestamp: 0,
    contact: {
      id,
      fullName: "Ada",
      jobTitle: null,
      company: null,
      mobileNumbers: [],
      telephoneNumbers: [],
      emails: [],
      website: null,
      address: null,
      companyLocation: null,
      linkedin: null,
      otherSocials: [],
      rawNotes: "secret notes",
    } as ProfileCollection.ProfileCollectionTaskPayload["contact"],
  };
}

describe("publishProfileCollectionTasks", () => {
  let ch: FakeChannel;

  beforeEach(() => {
    ch = new FakeChannel();
    vi.mocked(getChannel).mockResolvedValue(ch as never);
  });

  it("declares the queue once and publishes every task", async () => {
    const result = await publishProfileCollectionTasks([task("a"), task("b"), task("c")]);

    expect(result).toEqual({ queued: 3, failed: 0 });
    expect(ch.assertQueue).toHaveBeenCalledTimes(1);
    expect(ch.sendToQueue).toHaveBeenCalledTimes(3);
  });

  it("does not re-declare the queue for later publishes on the same channel", async () => {
    await publishProfileCollectionTasks([task("a")]);
    await publishProfileCollectionTask(task("b"));

    expect(ch.assertQueue).toHaveBeenCalledTimes(1);
  });

  it("strips rawNotes from the message body", async () => {
    await publishProfileCollectionTasks([task("a")]);

    const body = JSON.parse(ch.sent[0].toString());
    expect(body.contactId).toBe("a");
    expect(body.contact).not.toHaveProperty("rawNotes");
  });

  it("waits for drain on backpressure and counts the buffered message as queued", async () => {
    ch.flushResults = [false];
    setTimeout(() => ch.emit("drain"), 5);

    const result = await publishProfileCollectionTasks([task("a"), task("b")]);

    expect(result).toEqual({ queued: 2, failed: 0 });
  });

  it("stops and reports the rest as failed when the channel closes while full", async () => {
    ch.flushResults = [false];
    setTimeout(() => ch.emit("close"), 5);

    const result = await publishProfileCollectionTasks([task("a"), task("b"), task("c")]);

    expect(result).toEqual({ queued: 1, failed: 2 });
    expect(ch.sendToQueue).toHaveBeenCalledTimes(1);
  });

  it("fails every task when there is no channel", async () => {
    vi.mocked(getChannel).mockResolvedValue(null);

    const result = await publishProfileCollectionTasks([task("a"), task("b")]);

    expect(result).toEqual({ queued: 0, failed: 2 });
  });
});
