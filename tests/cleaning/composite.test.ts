import { describe, expect, it } from "vitest";

import { parseComposite } from "@/scripts/cleaning/composite";

describe("parseComposite", () => {
  it.each([
    [
      "ADITYA ENTERPRISES-EPC Contractor-Railway-MD-Purchase",
      "ADITYA ENTERPRISES - EPC Contractor - Railway",
      "MD - Purchase",
    ],
    [
      "AFCONS INFRASTRUCTURE LTD.-Water Division-Sr. Engineer-",
      "AFCONS INFRASTRUCTURE LTD. - Water Division",
      "Senior Engineer",
    ],
    [
      "Achme Water Solutions Pvt. Ltd.--CEO-",
      "Achme Water Solutions Pvt. Ltd.",
      "CEO",
    ],
    [
      "ANU TECH INFRA PRIVATE LIMITED--Sr. Executive-Procurement & Operation",
      "ANU TECH INFRA PRIVATE LIMITED",
      "Senior Executive - Procurement & Operation",
    ],
    [
      "ABN Tower and Transmission Private Limited---",
      "ABN Tower and Transmission Private Limited",
      null,
    ],
  ])("parseComposite(%j)", (input, company, jobTitle) => {
    expect(parseComposite(input)).toMatchObject({
      company,
      jobTitle,
      confidence: "high",
    });
  });

  it("appends the division to company and returns it separately", () => {
    const result = parseComposite(
      "ADITYA ENTERPRISES-EPC Contractor-Railway-MD-Purchase",
    );
    expect(result?.division).toBe("EPC Contractor - Railway");
    expect(result?.segments).toEqual([
      "ADITYA ENTERPRISES",
      "EPC Contractor",
      "Railway",
      "MD",
      "Purchase",
    ]);
  });

  it("lowers confidence when more than one title segment is found", () => {
    const result = parseComposite("ACME LTD-Manager-Director-Purchase");
    expect(result?.confidence).toBe("low");
  });

  it("returns null for blank input", () => {
    expect(parseComposite("   ")).toBeNull();
  });
});
