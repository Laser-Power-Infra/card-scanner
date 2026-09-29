import { vi } from "vitest";

// Strip anything that could let a test reach a live service.
delete process.env.OPENAI_API_KEY;
delete process.env.RABBITMQ_URL;
delete process.env.DATABASE_URL;

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
