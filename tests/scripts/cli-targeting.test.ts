import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS = [
  "phone-fields.ts",
  "clean-contact-fields.ts",
  "clean-name-job-company.ts",
  "backfill-location.ts",
  "backfill-contact-dedupe.ts",
  "process-contact.ts",
];

describe("cleanup CLIs are single-contact only", () => {
  for (const script of SCRIPTS) {
    it(`${script} requires --id and has no bulk query`, () => {
      const source = readFileSync(join(process.cwd(), "scripts", script), "utf8");

      expect(source).toContain("parseContactIdArg");
      expect(source).toContain("printContactIdUsage");
      expect(source).not.toMatch(/prisma\.contact\.findMany/);
      expect(source).not.toMatch(/--all/);
    });
  }
});
