import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync(
  join(process.cwd(), "app", "api", "scan", "route.ts"),
  "utf8",
);

describe("new-contact cleanup wiring", () => {
  it("schedules cleanup for the image create path", () => {
    expect(ROUTE).toContain("scheduleNewContactCleanup([created.id])");
  });

  it("schedules cleanup for every spreadsheet-created row", () => {
    expect(ROUTE).toContain("createdIds.push(createdContact.id)");
    expect(ROUTE).toContain("scheduleNewContactCleanup(createdIds)");
  });

  it("does not publish research directly from the create path", () => {
    expect(ROUTE).not.toContain("await pushResearchTask(created)");
  });

  it("still publishes research for merged duplicates", () => {
    expect(ROUTE).toContain("await publishResearchTask(updated)");
  });

  it("bounds the LLM pass with CONTACT_CLEANUP_LLM_MAX", () => {
    expect(ROUTE).toContain("CONTACT_CLEANUP_LLM_MAX");
  });
});
