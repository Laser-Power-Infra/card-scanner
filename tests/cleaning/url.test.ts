import { describe, expect, it } from "vitest";

import { normalizeLinkedin, normalizeWebsite } from "@/lib/cleaning/url";

describe("normalizeWebsite", () => {
  it.each([
    [
      "https://www.Lntecc.com",
      "https://www.lntecc.com",
      true,
      true,
    ],
    [
      "https://Lntecc.com/Our/Team",
      "https://lntecc.com/Our/Team",
      true,
      true,
    ],
    ["lntecc.com", "https://lntecc.com", true, true],
    ["http://", "http://", false, false],
    ["not a url", "notaurl", false, false],
  ])(
    "normalizeWebsite(%j) -> %j (changed %j, valid %j)",
    (input, value, changed, valid) => {
      expect(normalizeWebsite(input)).toEqual({ value, changed, valid });
    },
  );

  it("leaves an already-normalized URL unchanged", () => {
    expect(normalizeWebsite("https://lntecc.com")).toEqual({
      value: "https://lntecc.com",
      changed: false,
      valid: true,
    });
  });
});

describe("normalizeLinkedin", () => {
  it.each([
    [
      "https://linkedin.com/shivanighorawat",
      "https://linkedin.com/in/shivanighorawat",
      true,
    ],
    ["workwithvishnu", null, false],
    ["https://example.com/foo", null, false],
    ["https://linkedin.com/company/acme", null, false],
  ])("normalizeLinkedin(%j) -> %j (%j confident)", (input, value, confident) => {
    expect(normalizeLinkedin(input)).toEqual({ value, confident });
  });

  it("returns an already-correct /in/ URL unchanged", () => {
    expect(normalizeLinkedin("https://www.linkedin.com/in/shivanighorawat")).toEqual({
      value: "https://www.linkedin.com/in/shivanighorawat",
      confident: true,
    });
  });
});
