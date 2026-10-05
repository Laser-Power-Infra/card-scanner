import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { CardData } from "@/types/card";
import { prisma } from "@/lib/prisma";
import { extractCardFromImage } from "@/lib/extractCard";
import {
  buildOriginalImageKey,
  buildOriginalImageUrl,
  deleteOriginalImage,
  uploadOriginalImage,
} from "@/lib/s3";

import { POST as scanPOST } from "@/app/api/scan/route";

/**
 * S3-backed card images on POST /api/scan.
 *
 * The bucket stays private and the database stores the object KEY, so the two
 * halves that can disagree are the upload and the row: an object nobody points
 * at, and a row pointing at an object that was never written. Every case here
 * is aimed at one of those, plus the two guarantees the feature must not cost:
 * a repeat scan never replaces an image a contact already has, and a rejected
 * upload never reaches storage.
 *
 * lib/s3 is stubbed by tests/setup.ts, so no AWS SDK call is ever attempted here.
 * `buildOriginalImageKey` is stubbed too, and the real builder is exercised
 * separately through vi.importActual below — the stub exists so the route's own
 * key handling is readable, not to hide the key's shape.
 */

vi.mock("@/lib/extractCard", () => ({
  extractCardFromImage: vi.fn(),
}));

/** What the stubbed key builder hands back to the route. */
const KEY = "contacts/2026/10/test-key.png";

/** What the stubbed URL builder returns for that key. */
const IMAGE_URL = `https://storage.test/card-images/${KEY}`;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const CARD: CardData = {
  fullName: "Ada Lovelace",
  jobTitle: "Countess",
  company: "Analytical Engines",
  mobileNumbers: ["+919999999999"],
  telephoneNumbers: [],
  emails: ["ada@example.com"],
  website: null,
  address: null,
  companyLocation: null,
  linkedin: null,
  otherSocials: [],
  rawNotes: null,
};

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

const req = (body: FormData | undefined) =>
  new NextRequest(new URL("/api/scan", "http://localhost"), {
    method: "POST",
    body,
  } as NextRequestInit);

/** A well-formed PNG upload, which is the only thing that reaches storage. */
const imageUpload = (
  bytes: Uint8Array<ArrayBuffer> = PNG_BYTES,
  name = "card.png",
  type = "image/png"
) => {
  const form = new FormData();
  form.append("image", new File([bytes], name, { type }));

  return form;
};

const scanImage = () => scanPOST(req(imageUpload()));

/** A contact row as Prisma would hand it back, with the merge fields present. */
const existingContact = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "contact_existing",
    fullName: CARD.fullName,
    jobTitle: CARD.jobTitle,
    company: CARD.company,
    mobileNumbers: [...CARD.mobileNumbers],
    telephoneNumbers: [],
    emails: [...CARD.emails],
    website: null,
    address: null,
    companyLocation: null,
    linkedin: null,
    rawNotes: null,
    originalImageUrl: null,
    ...overrides,
  }) as never;

/** The single argument the route passed to a Prisma delegate. */
const lastArgs = <T>(fn: unknown) => {
  const mock = fn as { mock: { calls: unknown[][] } };

  return mock.mock.calls.at(-1)?.[0] as T;
};

/** The `data` half of a Prisma write, read by key. */
const writeData = (fn: unknown) => lastArgs<{ data: Record<string, unknown> }>(fn).data;

const uploadedKey = () =>
  vi.mocked(uploadOriginalImage).mock.calls.at(-1)?.[0] as string | undefined;

beforeEach(() => {
  vi.mocked(extractCardFromImage).mockResolvedValue(CARD);
  vi.mocked(buildOriginalImageKey).mockReturnValue(KEY);
  vi.mocked(uploadOriginalImage).mockResolvedValue(undefined);
  vi.mocked(deleteOriginalImage).mockResolvedValue(undefined);
  vi.mocked(prisma.contact.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact_new" } as never);
  vi.mocked(prisma.contact.update).mockResolvedValue({ id: "contact_existing" } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("a new scan stores the original image in S3 and on the contact", () => {
  it("uploads the received image bytes under the generated key", async () => {
    const response = await scanImage();

    expect(response.status).toBe(200);
    expect(vi.mocked(uploadOriginalImage)).toHaveBeenCalledTimes(1);

    const [key, body, contentType] = vi.mocked(uploadOriginalImage).mock.calls[0];

    expect(key).toBe(KEY);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(Buffer.from(body as Buffer).equals(Buffer.from(PNG_BYTES))).toBe(true);
    expect(contentType).toBe("image/png");
  });

  it("stores the object key, not a URL, on the created contact", async () => {
    await scanImage();

    expect(writeData(prisma.contact.create)).toMatchObject({
      fullName: CARD.fullName,
      company: CARD.company,
      originalImageUrl: IMAGE_URL,
    });
    expect(vi.mocked(buildOriginalImageUrl)).toHaveBeenCalledWith(KEY);
  });

  it("does not delete an object the contact now points at", async () => {
    await scanImage();

    expect(deleteOriginalImage).not.toHaveBeenCalled();
  });

  it("hands back the same success envelope as before", async () => {
    const response = await scanImage();
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data.id).toBe("contact_new");
  });
});

describe("the object key is unique, dated and derived from the content type", () => {
  it("matches contacts/{year}/{month}/{uuid}.{ext} and never repeats", async () => {
    const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
    const now = new Date("2026-10-05T12:00:00Z");

    const jpeg = actual.buildOriginalImageKey("image/jpeg", "photo.jpeg", now);

    expect(jpeg).toMatch(
      /^contacts\/2026\/10\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/
    );

    // Same card, same name, same second: the uuid is what keeps them apart.
    const first = actual.buildOriginalImageKey("image/png", "card.png", now);
    const second = actual.buildOriginalImageKey("image/png", "card.png", now);

    expect(first).not.toBe(second);
    expect(first).not.toContain("card.png");
  });

  it("ignores the uploaded filename as the identifier", async () => {
    const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");

    const key = actual.buildOriginalImageKey(
      "image/png",
      "../../etc/passwd.png",
      new Date("2026-10-05T12:00:00Z")
    );

    expect(key.startsWith("contacts/2026/10/")).toBe(true);
    expect(key).not.toContain("..");
  });

  it("builds a path-style public URL from the key and normalizes a trailing slash", async () => {
    const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");

    process.env.AWS_ENDPOINT_URL_S3 =
      "https://br-test.storage.c-3.ap-southeast-1.aws.neon.tech/";
    process.env.AWS_S3_BUCKET = "card-images";

    try {
      const url = actual.buildOriginalImageUrl("contacts/2026/10/abc.png");

      expect(url).toBe(
        "https://br-test.storage.c-3.ap-southeast-1.aws.neon.tech/card-images/contacts/2026/10/abc.png"
      );
    } finally {
      delete process.env.AWS_ENDPOINT_URL_S3;
      delete process.env.AWS_S3_BUCKET;
    }
  });
});

describe("a failed upload never produces a contact", () => {
  it("answers 500 and writes nothing when storage rejects the image", async () => {
    vi.mocked(uploadOriginalImage).mockRejectedValueOnce(new Error("AccessDenied"));

    const response = await scanImage();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Could not store the uploaded image. Please try again.",
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it("does not leak the storage error into the response", async () => {
    vi.mocked(uploadOriginalImage).mockRejectedValueOnce(
      new Error("AccessDenied: bucket card-scanner-prod")
    );

    const text = await (await scanImage()).text();

    expect(text).not.toContain("card-scanner-prod");
  });

  it("leaves nothing to clean up when the upload itself failed", async () => {
    vi.mocked(uploadOriginalImage).mockRejectedValueOnce(new Error("AccessDenied"));

    await scanImage();

    expect(deleteOriginalImage).not.toHaveBeenCalled();
  });
});

describe("a failed write does not leave an orphaned object", () => {
  it("deletes the uploaded object when the contact row cannot be created", async () => {
    vi.mocked(prisma.contact.create).mockRejectedValueOnce(new Error("deadlock detected"));

    const response = await scanImage();

    expect(response.status).toBe(500);
    expect(uploadedKey()).toBe(KEY);
    expect(deleteOriginalImage).toHaveBeenCalledTimes(1);
    expect(deleteOriginalImage).toHaveBeenCalledWith(KEY);
  });

  it("deletes the uploaded object when the merge update fails", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(existingContact());
    vi.mocked(prisma.contact.update).mockRejectedValueOnce(new Error("deadlock detected"));

    const response = await scanImage();

    expect(response.status).toBe(500);
    expect(deleteOriginalImage).toHaveBeenCalledWith(KEY);
  });

  it("still reports the database error when the cleanup also fails", async () => {
    vi.mocked(prisma.contact.create).mockRejectedValueOnce(new Error("deadlock detected"));
    vi.mocked(deleteOriginalImage).mockRejectedValueOnce(new Error("NoSuchBucket"));

    const response = await scanImage();

    // The database failure is the one the caller can act on, so the cleanup
    // failure must not replace it.
    expect((await response.json()).error).toContain("deadlock detected");
  });
});

describe("an existing contact's image reference is never overwritten", () => {
  it("uploads nothing and writes nothing when a repeat scan adds no new field", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(
      existingContact({
        originalImageUrl: "https://storage.test/card-images/contacts/2025/01/original.png",
      })
    );

    const response = await scanImage();
    const body = await response.json();

    expect(body.message).toBe("duplicate_skipped");
    expect(body.alreadyExists).toBe(true);
    // No upload is what keeps the reference intact; an upload here would leave
    // an object no row points at.
    expect(uploadOriginalImage).not.toHaveBeenCalled();
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(body.data.originalImageUrl).toBe(
      "https://storage.test/card-images/contacts/2025/01/original.png"
    );
  });

  it("leaves the stored key alone while merging genuinely new fields", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(
      existingContact({
        emails: [],
        originalImageUrl: "https://storage.test/card-images/contacts/2025/01/original.png",
      })
    );

    const response = await scanImage();
    const body = await response.json();

    expect(body.message).toBe("merged");

    const update = writeData(prisma.contact.update);

    expect(update.emails).toEqual(["ada@example.com"]);
    // The key is absent from the update, not merely equal to the old one: a
    // contact that already has an image never re-uploads it.
    expect(Object.keys(update)).not.toContain("originalImageUrl");
    expect(uploadOriginalImage).not.toHaveBeenCalled();
    expect(deleteOriginalImage).not.toHaveBeenCalled();
  });

  it("fills a missing image reference, treating it like any other new field", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(existingContact());

    const response = await scanImage();
    const body = await response.json();

    expect(body.message).toBe("merged");
    expect(uploadedKey()).toBe(KEY);
    expect(writeData(prisma.contact.update)).toMatchObject({
      originalImageUrl: IMAGE_URL,
    });
  });
});

describe("the pre-existing scan behaviour is untouched", () => {
  it("still refuses a missing file before touching storage", async () => {
    const response = await scanPOST(req(new FormData()));

    expect(response.status).toBe(400);
    expect(uploadOriginalImage).not.toHaveBeenCalled();
    expect(extractCardFromImage).not.toHaveBeenCalled();
  });

  it("still refuses an unsupported type before touching storage", async () => {
    const form = new FormData();
    form.append("image", new File([PNG_BYTES], "card.txt", { type: "text/plain" }));

    const response = await scanPOST(req(form));

    expect(response.status).toBe(415);
    expect(uploadOriginalImage).not.toHaveBeenCalled();
    expect(extractCardFromImage).not.toHaveBeenCalled();
  });

  it("still refuses a card with no name or company, storing nothing", async () => {
    vi.mocked(extractCardFromImage).mockResolvedValue({
      ...CARD,
      company: "   ",
    });

    const response = await scanImage();

    expect(response.status).toBe(400);
    expect(uploadOriginalImage).not.toHaveBeenCalled();
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it("still refuses an oversized image before touching storage", async () => {
    const response = await scanPOST(req(imageUpload(new Uint8Array(9 * 1024 * 1024))));

    expect(response.status).toBe(413);
    expect(uploadOriginalImage).not.toHaveBeenCalled();
    expect(extractCardFromImage).not.toHaveBeenCalled();
  });
});
