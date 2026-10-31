import { describe, expect, it } from "vitest";

import {
  canonicalState,
  PIN_PREFIX_TO_STATE,
  repairCompanyLocation,
} from "@/lib/cleaning/locationFix";

describe("canonicalState", () => {
  it.each([
    ["Uttar Pradesh", "Uttar Pradesh"],
    ["uttar pradesh", "Uttar Pradesh"],
    ["Uttar Prades", "Uttar Pradesh"],
    ["Uttarakhand", "Uttarakhand"],
    ["KA", "Karnataka"],
    ["UP", "Uttar Pradesh"],
    ["MH", "Maharashtra"],
    ["Orissa", "Odisha"],
    ["Pondicherry", "Puducherry"],
    ["New Delhi", "Delhi"],
    ["Uttar", null],
    ["Pud", null],
    ["Nowhere", null],
    ["", null],
  ])("canonicalState(%j) -> %j", (input, expected) => {
    expect(canonicalState(input)).toBe(expected);
  });
});

describe("PIN_PREFIX_TO_STATE", () => {
  it("maps the confident seed prefixes", () => {
    expect(PIN_PREFIX_TO_STATE["20"]).toBe("Uttar Pradesh");
    expect(PIN_PREFIX_TO_STATE["12"]).toBe("Haryana");
  });
});

describe("repairCompanyLocation", () => {
  it.each([
    [
      "Uttar Prades ::: Uttar Prades",
      null,
      { value: "Uttar Pradesh", source: "text", confidence: "high" },
    ],
    [":::", null, { value: null, source: "none", confidence: "low" }],
    [
      "Gurugram-122016, India",
      null,
      { value: "Haryana", source: "pincode", confidence: "high" },
    ],
    [
      "Noida - 201301, Delhi.",
      null,
      {
        value: "Uttar Pradesh",
        source: "pincode",
        confidence: "high",
        conflict: "text said Delhi",
      },
    ],
    [
      "Delhi - 110001",
      null,
      { value: "Delhi", source: "existing", confidence: "high" },
    ],
  ])(
    "repairCompanyLocation(%j, %j) -> %j",
    (raw, address, expected) => {
      expect(repairCompanyLocation(raw, address)).toMatchObject(expected);
    },
  );

  it("uses the address pincode when the raw value carries no location", () => {
    expect(repairCompanyLocation("Acme Pvt Ltd", "Sector 1, 122001")).toMatchObject({
      value: "Haryana",
      source: "pincode",
      confidence: "high",
    });
  });

  it("flags review for a resolvable-looking value with an unknown pincode", () => {
    expect(repairCompanyLocation("Foo ::: 999999", null)).toEqual({
      value: null,
      source: "none",
      confidence: "low",
      review: "no pincode or state match",
    });
  });

  it("does not flag review for a genuinely empty input", () => {
    expect(repairCompanyLocation("::: :::", null)).toEqual({
      value: null,
      source: "none",
      confidence: "low",
    });
  });

  it.each([
    ["KA ::: KA", "Karnataka"],
    ["HUBBALLI Karnataka - 580 029", "Karnataka"],
    ["Mumbai", "Maharashtra"],
    ["New Delhi, India", "Delhi"],
    ["kanpur Uttar Prades; :::", "Uttar Pradesh"],
    ["Orissa ::: Orissa", "Odisha"],
  ])("resolves %j via aliases/city/contained scan -> %j", (raw, expected) => {
    expect(repairCompanyLocation(raw, null)).toMatchObject({
      value: expected,
      confidence: "high",
    });
  });
});
