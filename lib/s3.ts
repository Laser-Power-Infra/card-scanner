// Server-only. Credentials are read from the environment at call time and the
// bucket is never public, so nothing here may be imported from a client
// component — the whole module would end up in the browser bundle.
import { randomUUID } from "crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const globalForS3 = globalThis as unknown as {
  s3Client: S3Client | undefined;
};

// The extension comes from the MIME type rather than the filename: the
// filename is attacker-supplied, and the stored ContentType is what a browser
// will act on if the key is ever served back.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[S3] ${name} is not set`);
  }

  return value;
}

function getClient(): S3Client {
  if (!globalForS3.s3Client) {
    globalForS3.s3Client = new S3Client({
      region: requiredEnv("AWS_REGION"),
      credentials: {
        accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
      },
      // Path-style addressing keeps the bucket in the path. Virtual-host style
      // prepends <bucket>. to a custom endpoint, and the S3-compatible host's
      // wildcard cert only covers one label, so the upload dies on TLS.
      forcePathStyle: true,
    });
  }

  return globalForS3.s3Client;
}

function extensionFor(contentType: string, filename?: string | null): string {
  const known = EXTENSION_BY_CONTENT_TYPE[contentType];

  if (known) return known;

  const fromName = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];

  return fromName && fromName.length <= 8 ? fromName : "bin";
}

/**
 * A key nobody else can pick: the original filename is never the identifier,
 * so two people photographing the same card cannot collide, and the date
 * prefix keeps the bucket browsable.
 */
export function buildOriginalImageKey(
  contentType: string,
  filename?: string | null,
  now: Date = new Date()
): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `contacts/${year}/${month}/${randomUUID()}.${extensionFor(contentType, filename)}`;
}

export async function uploadOriginalImage(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: requiredEnv("AWS_S3_BUCKET"),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteOriginalImage(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: requiredEnv("AWS_S3_BUCKET"),
      Key: key,
    })
  );
}
