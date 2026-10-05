import { describe, expect, it } from "vitest";

import {
  canonicalCompanyKey,
  cleanCompany,
  companyIsPersonName,
  isBareCity,
  looksLikePersonName,
} from "@/scripts/cleaning/company";

describe("canonicalCompanyKey", () => {
  it("makes L&T / LnT / LNT collide", () => {
    const a = canonicalCompanyKey("L&T Chennai");
    expect(canonicalCompanyKey("LnT Chennai")).toBe(a);
    expect(canonicalCompanyKey("LNT CHENNAI")).toBe(a);
  });

  it("makes Pvt Ltd and Private Limited collide", () => {
    expect(canonicalCompanyKey("ABC Pvt. Ltd.")).toBe(
      canonicalCompanyKey("ABC Private Limited"),
    );
  });

  it.each([
    ["ABC Pvt. Ltd.", "abc"],
    ["L&T Chennai", "lnt chennai"],
    ["ACME Corp - Water Division", "acme corp"],
    [null, ""],
    ["   ", ""],
  ])("canonicalCompanyKey(%j) -> %j", (input, expected) => {
    expect(canonicalCompanyKey(input as string | null)).toBe(expected);
  });
});

describe("cleanCompany", () => {
  it("dedupes case/punctuation-insensitively and strips dash runs", () => {
    expect(
      cleanCompany(
        "A K INFRAPROJECTS PRIVATE LIMITED---; A.K. Infra Projects Pvt. Ltd.---",
      ),
    ).toBe("A K INFRAPROJECTS PRIVATE LIMITED");
  });

  it.each([
    [null, null],
    ["   ", null],
    ["Foo Bar; Foo Bar", "Foo Bar"],
    ["ACME---; ACME", "ACME"],
    ["Alpha; Beta", "Alpha; Beta"],
  ])("cleanCompany(%j) -> %j", (input, expected) => {
    expect(cleanCompany(input as string | null)).toBe(expected);
  });
});

describe("looksLikePersonName", () => {
  it.each([
    ["Gyan Vishwakarma", true],
    ["A B", true],
    ["Gyan", false],
    ["Rashmi Electricals Private Limited Company", false],
    [null, false],
  ])("looksLikePersonName(%j) -> %j", (input, expected) => {
    expect(looksLikePersonName(input as string | null)).toBe(expected);
  });
});

describe("companyIsPersonName", () => {
  it.each([
    ["Gyan Vishwakarma", "Gyan Vishwakarma", true],
    // Full-token containment.
    ["Gyan Vishwakarma", "Vishwakarma Gyan", true],
    // Conservative: company words disqualify.
    ["Gyan Vishwakarma", "Vishwakarma Associates", false],
    ["Gyan Vishwakarma", "Vishwakarma Engineers", false],
    ["Gyan Vishwakarma", "Some Other", false],
  ])("companyIsPersonName(%j, %j) -> %j", (fullName, company, expected) => {
    expect(companyIsPersonName(fullName, company)).toBe(expected);
  });
});

describe("isBareCity", () => {
  it.each([
    ["Chennai", true],
    ["CHENNAI", true],
    ["Chennai Division", false],
    ["Nowhereville", false],
    ["", false],
  ])("isBareCity(%j) -> %j", (input, expected) => {
    expect(isBareCity(input)).toBe(expected);
  });
});
