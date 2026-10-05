import { describe, expect, it } from "vitest";

import { detectFlags, RULE_SEVERITY } from "@/scripts/cleaning/validators";

function contact(overrides: Partial<Parameters<typeof detectFlags>[0]> = {}) {
  return {
    id: "c1",
    fullName: "Asha Verma",
    jobTitle: "Manager",
    company: "Asha Traders",
    mobileNumbers: [] as string[],
    telephoneNumbers: [] as string[],
    emails: [] as string[],
    website: null,
    address: null,
    companyLocation: null,
    linkedin: null,
    ...overrides,
  };
}

function rules(flags: ReturnType<typeof detectFlags>): string[] {
  return flags.map((f) => f.rule);
}

describe("detectFlags", () => {
  it("flags a mobile number sitting in telephoneNumbers", () => {
    const flags = detectFlags(contact({ telephoneNumbers: ["+91 9350251170"] }));
    expect(rules(flags)).toContain("TEL_CONTAINS_MOBILE");
  });

  it("does not flag a clean landline as a mobile", () => {
    const flags = detectFlags(contact({ telephoneNumbers: ["+918043307405"] }));
    expect(rules(flags)).not.toContain("TEL_CONTAINS_MOBILE");
  });

  it("flags a source tag and a missing job title", () => {
    const flags = detectFlags(contact({ fullName: "DOM Rahul Bhagwat", jobTitle: null }));
    expect(rules(flags)).toContain("NAME_SOURCE_TAG");
    expect(rules(flags)).toContain("JOB_MISSING");
  });

  it("flags ::: location junk and a missing location with an address", () => {
    expect(rules(detectFlags(contact({ companyLocation: ":::" })))).toContain(
      "LOCATION_SEPARATOR_ONLY",
    );
    expect(rules(detectFlags(contact({ companyLocation: null, address: "Noida 201301" })))).toContain(
      "LOCATION_MISSING_ADDRESS_AVAILABLE",
    );
  });

  it("flags an invalid email and an all-caps name", () => {
    const flags = detectFlags(contact({ emails: ["exp @gemforgings.com"], fullName: "RAHUL BHAGWAT" }));
    expect(rules(flags)).toContain("EMAIL_INVALID");
    expect(rules(flags)).toContain("NAME_ALLCAPS");
  });

  it("flags a DONE enrichment that says the person was not verified", () => {
    const flags = detectFlags(contact(), {
      status: "DONE",
      linkedin_url: null,
      official_site: null,
      location: null,
      company_details: null,
      career_background: null,
      summary: "The person did not clearly identify a current employer.",
      attempts: 0,
      completed: 0,
      failed: 0,
      expected: 0,
      enriched_at: null,
    });
    expect(rules(flags)).toContain("ENR_DONE_BUT_UNVERIFIED");
    expect(rules(flags)).toContain("ENR_COUNTERS_UNSET");
  });

  it("assigns a severity to every rule it emits", () => {
    const flags = detectFlags(contact({ companyLocation: ":::", jobTitle: null }));
    for (const flag of flags) {
      expect(RULE_SEVERITY[flag.rule]).toBe(flag.severity);
    }
  });
});
