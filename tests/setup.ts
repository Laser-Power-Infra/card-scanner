import { vi } from "vitest";

// Strip anything that could let a test reach a live service.
delete process.env.OPENAI_API_KEY;
delete process.env.RABBITMQ_URL;
delete process.env.DATABASE_URL;

// lib/s3.ts would otherwise build a real S3Client from these. Stripped as well as
// mocked, so a future test that reaches past the mock still cannot authenticate.
delete process.env.AWS_REGION;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_S3_BUCKET;

// next-auth's JWT callbacks read this at module scope; a fixed test value makes
// token encoding deterministic.
process.env.NEXTAUTH_SECRET = "test-secret-not-used-in-production";

// lib/prisma.ts:10 constructs a PrismaPg adapter at module scope from DATABASE_URL.
// Mocking the module means the adapter and the client are never constructed, so no
// socket is opened even though DATABASE_URL is absent.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    locationCache: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    passwordResetToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
  },
}));

// lib/rabbitmq.ts would otherwise read RABBITMQ_URL and attempt a TCP connect.
vi.mock("@/lib/rabbitmq", () => ({
  getChannel: vi.fn(async () => null),
  closeConnection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/queue/profileCollection", () => ({
  publishProfileCollectionTask: vi.fn(async () => false),
}));

// lib/s3.ts is replaced wholesale rather than mocked at the SDK boundary, so the
// AWS SDK is never loaded in a test process at all. `buildOriginalImageKey` is
// stubbed to a fixed key because the route only ever stores what it returns;
// tests/scan/original-image.test.ts exercises the real key builder through
// vi.importActual.
vi.mock("@/lib/s3", () => ({
  buildOriginalImageKey: vi.fn(() => "contacts/2026/10/test-key.png"),
  buildOriginalImageUrl: vi.fn(
    (key: string) => `https://storage.test/card-images/${key}`
  ),
  uploadOriginalImage: vi.fn(async () => undefined),
  deleteOriginalImage: vi.fn(async () => undefined),
}));

// lib/extractCard.ts:75 and app/api/profile/enrich/route.ts:90 both call
// `new OpenAI(...)`. The mock throws on construction so an unmocked test path
// fails at the boundary instead of issuing a billable request.
vi.mock("openai", () => ({
  default: class {
    constructor() {
      throw new Error("openai must be mocked in tests");
    }
  },
}));

// next-auth's getServerSession is replaced per test file. The default is "no
// session", which is the state every auth-boundary test starts from.
vi.mock("next-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth")>();
  return {
    ...actual,
    getServerSession: vi.fn(async () => null),
  };
});
