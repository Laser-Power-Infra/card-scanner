import { describe, expect, it } from "vitest";

import {
  extractQualifications,
  isNotARole,
  normalizeTitle,
  stripCompanyFromJob,
} from "@/lib/cleaning/job";

describe("normalizeTitle", () => {
  it.each([
    ["Sr. Manager - Procurement", "Senior Manager - Procurement"],
    ["Managing Director Managing Director", "Managing Director"],
    ["(Head Of Projects)", "Head Of Projects"],
    ["Manager-Procurement", "Manager - Procurement"],
    // Lowercase-start title is title-cased; acronyms are preserved.
    ["senior manager - purchase", "Senior Manager - Purchase"],
    ["dgm operations", "DGM Operations"],
    // Intra-word hyphen on a known compound prefix is left alone.
    ["Co-Ordinator", "Co-Ordinator"],
    [null, null],
    ["   ", null],
  ])("normalizeTitle(%j) -> %j", (input, expected) => {
    expect(normalizeTitle(input as string | null)).toBe(expected);
  });
});

describe("stripCompanyFromJob", () => {
  it.each([
    // Company joined at the END by "of" as a whole word.
    [
      "CEO and proprietor of Rashmi Electricals",
      "Rashmi Electricals",
      "CEO and proprietor",
    ],
    // Company joined at the START by " - ".
    ["Rashmi Electricals - CEO", "Rashmi Electricals", "CEO"],
    // No whole-word boundary: company is only a mid-string substring -> kept.
    [
      "GOVT LICENSED ELECTRICAL CONTRACTOR",
      "Electrical Sales",
      "GOVT LICENSED ELECTRICAL CONTRACTOR",
    ],
    // Job is exactly the company.
    ["Rashmi Electricals", "Rashmi Electricals", ""],
  ])("stripCompanyFromJob(%j, %j) -> %j", (job, company, expected) => {
    expect(stripCompanyFromJob(job, company)).toBe(expected);
  });
});

describe("extractQualifications", () => {
  it.each([
    [
      "B. Bc Engr(EEE), MBA(MKt), PGD(PM), F(IEB) Chief Executive Officer",
      {
        title: "Chief Executive Officer",
        quals: ["B. Bc Engr(EEE)", "MBA(MKt)", "PGD(PM)", "F(IEB)"],
      },
    ],
    // A bare degree name: residual is not role-like, so title is null.
    [
      "M.Tech-Construction Management",
      { title: null, quals: ["M.Tech", "Construction Management"] },
    ],
  ])("extractQualifications(%j)", (input, expected) => {
    expect(extractQualifications(input)).toEqual(expected);
  });

  it("returns empty quals when no credential is present", () => {
    expect(extractQualifications("Purchase Manager")).toEqual({
      title: "Purchase Manager",
      quals: [],
    });
  });
});

describe("isNotARole", () => {
  it.each([
    ["TURNKEY CONTRACTORS", true],
    ["Code-910577", true],
    ["2 gw module and cell line", true],
    ["Purchase", false],
    ["Procurement", false],
    ["SCM", false],
    [null, true],
  ])("isNotARole(%j) -> %j", (input, expected) => {
    expect(isNotARole(input as string | null)).toBe(expected);
  });
});
