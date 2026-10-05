import { describe, expect, it } from "vitest";

import {
  normalizeNumberSets,
  parsePhone,
  splitConcatenated,
} from "@/scripts/cleaning/phone";

describe("parsePhone", () => {
  it.each([
    ["+91-80-43307405", "+918043307405", "LANDLINE"],
    ["+91-79-68268000", "+917968268000", "LANDLINE"],
    ["+91-755-2586160", "+917552586160", "LANDLINE"],
    ["+91 9350251170", "+919350251170", "MOBILE"],
    ["+91 0321 2247244", "+913212247244", "LANDLINE"],
    ["9595985408", "+919595985408", "MOBILE"],
    ["+977 9801018007", "+9779801018007", "MOBILE"],
  ])("parses %j as %j (%s)", (raw, e164, kind) => {
    const parsed = parsePhone(raw);
    expect(parsed.e164).toBe(e164);
    expect(parsed.kind).toBe(kind);
  });

  it.each([
    ["+94 01183837"],
    ["+91 19899983"],
  ])("keeps invalid %j as INVALID with null e164", (raw) => {
    const parsed = parsePhone(raw);
    expect(parsed.kind).toBe("INVALID");
    expect(parsed.e164).toBeNull();
  });

  it("extracts an extension and preserves the E.164 number", () => {
    const parsed = parsePhone("+91 22 2575 1000 Extn.1422");
    expect(parsed.e164).toBe("+912225751000");
    expect(parsed.ext).toBe("1422");
    expect(parsed.kind).toBe("LANDLINE");
  });

  it("handles the space + x extension form", () => {
    const parsed = parsePhone("+912225751000 x1422");
    expect(parsed.e164).toBe("+912225751000");
    expect(parsed.ext).toBe("1422");
  });
});

describe("splitConcatenated", () => {
  it("splits two Nepali mobiles sharing a country code", () => {
    const parsed = splitConcatenated("+977 98010180079851044687");
    expect(parsed?.map((p) => p.e164)).toEqual([
      "+9779801018007",
      "+9779851044687",
    ]);
    expect(parsed?.every((p) => p.kind === "MOBILE")).toBe(true);
  });

  it("splits a comma-separated mobile + landline", () => {
    const parsed = splitConcatenated("+91 8130111500, 011-25623158");
    expect(parsed?.map((p) => p.e164)).toEqual([
      "+918130111500",
      "+911125623158",
    ]);
  });

  it("returns null when no valid split consumes every digit", () => {
    expect(splitConcatenated("+977 985109070697715535473")).toBeNull();
  });

  it("returns null for inputs at or below the 15-digit threshold", () => {
    expect(splitConcatenated("+91 8130111500")).toBeNull();
  });
});

describe("normalizeNumberSets", () => {
  it("moves valid landlines into tels", () => {
    const result = normalizeNumberSets({
      mobiles: [],
      tels: ["+91-80-43307405", "+91-79-68268000", "+91-755-2586160"],
    });
    expect(result.mobiles).toEqual([]);
    expect(result.tels).toEqual([
      "+918043307405",
      "+917968268000",
      "+917552586160",
    ]);
    expect(result.review).toEqual([]);
  });

  it("keeps invalid entries in place and records them for review", () => {
    const result = normalizeNumberSets({
      mobiles: [],
      tels: ["+94 01183837", "+91 19899983"],
    });
    expect(result.mobiles).toEqual([]);
    expect(result.tels).toEqual(["+94 01183837", "+91 19899983"]);
    expect(result.review).toHaveLength(2);
  });

  it("moves a valid mobile out of tels", () => {
    const result = normalizeNumberSets({
      mobiles: [],
      tels: ["+91 9350251170"],
    });
    expect(result.mobiles).toEqual(["+919350251170"]);
    expect(result.tels).toEqual([]);
  });

  it("dedupes a mobile that also appears inside a concatenated tel", () => {
    const result = normalizeNumberSets({
      mobiles: ["+91 8130111500"],
      tels: ["+91 8130111500, 011-25623158"],
    });
    expect(result.mobiles).toEqual(["+918130111500"]);
    expect(result.tels).toEqual(["+911125623158"]);
  });

  it("dedupes a plain and a +91-prefixed mobile", () => {
    const result = normalizeNumberSets({
      mobiles: ["9595985408"],
      tels: ["+91 9595985408"],
    });
    expect(result.mobiles).toEqual(["+919595985408"]);
    expect(result.tels).toEqual([]);
  });

  it("splits a concatenated tel into two mobiles", () => {
    const result = normalizeNumberSets({
      mobiles: [],
      tels: ["+977 98010180079851044687"],
    });
    expect(result.mobiles).toEqual([
      "+9779801018007",
      "+9779851044687",
    ]);
    expect(result.tels).toEqual([]);
  });

  it("leaves an unsplittable concatenation for review", () => {
    const raw = "+977 985109070697715535473";
    const result = normalizeNumberSets({ mobiles: [], tels: [raw] });
    expect(result.mobiles).toEqual([]);
    expect(result.tels).toEqual([raw]);
    expect(result.review).toHaveLength(1);
    expect(result.review[0].raw).toBe(raw);
  });

  it("is idempotent across the fixture set", () => {
    const inputs = [
      { mobiles: [], tels: ["+91-80-43307405", "+91 9350251170"] },
      { mobiles: ["+91 8130111500"], tels: ["+91 8130111500, 011-25623158"] },
      { mobiles: ["9595985408"], tels: ["+91 9595985408"] },
      { mobiles: [], tels: ["+977 98010180079851044687"] },
      { mobiles: [], tels: ["+94 01183837", "+91 19899983"] },
      { mobiles: [], tels: ["+977 985109070697715535473"] },
    ];

    for (const input of inputs) {
      const once = normalizeNumberSets(input);
      const twice = normalizeNumberSets({
        mobiles: once.mobiles,
        tels: once.tels,
      });
      expect(twice.mobiles).toEqual(once.mobiles);
      expect(twice.tels).toEqual(once.tels);
    }
  });
});

describe("normalizeNumberSets never moves a LANDLINE into mobiles", () => {
  it.each([
    ["+91-80-43307405", "+918043307405"],
    ["+91-79-68268000", "+917968268000"],
    ["+91-755-2586160", "+917552586160"],
    ["+91 0321 2247244", "+913212247244"],
    ["+91 22 2575 1000 Extn.1422", "+912225751000"],
  ])("keeps %j out of mobiles", (raw, e164) => {
    const result = normalizeNumberSets({ mobiles: [], tels: [raw] });
    expect(result.mobiles).not.toContain(e164);
    expect(result.tels).toContain(e164);
  });
});
