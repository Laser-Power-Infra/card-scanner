import { describe, expect, it } from "vitest";
import {
  applyPersonLlmResult,
  planPersonName,
  type PersonLlmRow,
} from "@/lib/cleaning/personName";

const SOURCE = {
  id: "c1",
  fullName: "Mr. John Doe",
  jobTitle: "Sr. Manager",
  company: "Acme Pvt Ltd",
  website: null,
  emails: [],
  enrichment: null,
};

describe("planPersonName", () => {
  it("strips honorifics and expands job abbreviations", () => {
    const plan = planPersonName(SOURCE);

    expect(plan.fields.fullName).toBe("John Doe");
    expect(plan.fields.jobTitle).toBe("Senior Manager");
    expect(plan.fields.company).toBe("Acme Pvt Ltd");
  });

  it("flags an import tag and queues exactly one LLM row", () => {
    const plan = planPersonName({ ...SOURCE, fullName: "DOM Rakesh Kumar" });

    expect(plan.fields.fullName).toBe("Rakesh Kumar");
    expect(plan.llmRow?.flags).toContain("source_tag");
  });

  it("never queues a china sourcing lead", () => {
    const plan = planPersonName({ ...SOURCE, fullName: "china sourcing lead" });

    expect(plan.llmRow).toBeNull();
    expect(plan.reviews).toContainEqual(
      expect.objectContaining({ reason: "sourcing_lead" }),
    );
  });

  it("rejects an LLM name that was never in the input", () => {
    const raw: PersonLlmRow = {
      id: "c1",
      fullName: "Mr. John Doe",
      jobTitle: "Sr. Manager",
      company: "Acme Pvt Ltd",
      flags: ["source_tag"],
    };
    const current = { fullName: "John Doe", jobTitle: "Senior Manager", company: "Acme Pvt Ltd" };

    const applied = applyPersonLlmResult(raw, current, {
      id: "c1",
      fullName: "Jane Smith",
      jobTitle: null,
      company: null,
      confidence: 0.9,
    });

    expect(applied.fields).toEqual(current);
    expect(applied.review?.reason).toContain("invented_name");
  });
});
