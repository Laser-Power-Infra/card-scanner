import { describe, expect, it } from "vitest";
import { planContactFields } from "@/lib/cleaning/contactFields";

const BASE = {
  fullName: null,
  jobTitle: null,
  company: null,
  address: null,
  emails: [],
  website: null,
  linkedin: null,
};

describe("planContactFields", () => {
  it("repairs an email whose domain is already present on the row", () => {
    const plan = planContactFields(
      { ...BASE, emails: ["john @example.com"] },
      new Map([["example.com", 1]]),
    );

    expect(plan.data.emails).toEqual(["john@example.com"]);
  });

  it("normalizes a website host without touching the path case", () => {
    const plan = planContactFields(
      { ...BASE, website: "Example.COM/Path" },
      new Map(),
    );

    expect(plan.data.website).toBe("https://example.com/Path");
  });

  it("repairs deterministic mojibake", () => {
    const plan = planContactFields(
      { ...BASE, fullName: "JosÃ© Silva" },
      new Map(),
    );

    expect(plan.data.fullName).toBe("José Silva");
  });

  it("rewrites a linkedin profile URL to /in/<slug>", () => {
    const plan = planContactFields(
      { ...BASE, linkedin: "https://linkedin.com/johndoe" },
      new Map(),
    );

    expect(plan.data.linkedin).toBe("https://linkedin.com/in/johndoe");
  });

  it("reviews an address without a pincode and never rewrites it", () => {
    const plan = planContactFields(
      { ...BASE, address: "Somewhere in Bengaluru" },
      new Map(),
    );

    expect(plan.data.address).toBeUndefined();
    expect(plan.reviews).toContainEqual(
      expect.objectContaining({ field: "address", reason: "address_no_pincode" }),
    );
  });
});
