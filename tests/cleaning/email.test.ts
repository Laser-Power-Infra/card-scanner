import { describe, expect, it } from "vitest";

import {
  repairEmailSpaces,
  resolveOcrVariants,
  validateEmail,
} from "@/scripts/cleaning/email";

describe("validateEmail", () => {
  it.each([
    ["amitagarwal@laserpowerinfra.com", true],
    ["francis@sepc.in", true],
    ["a@b.co", true],
    ["ex p@gemforgings.com", false],
    ["noat.example.com", false],
    ["a@b", false],
    ["a@b.c", false],
    ["a@b..com", false],
    ["a@b.com.", false],
    ["a@@b.com", false],
    ["", false],
    ["   ", false],
  ])("validateEmail(%j) -> %j", (input, expected) => {
    expect(validateEmail(input)).toBe(expected);
  });
});

describe("repairEmailSpaces", () => {
  it.each([
    [
      "amitagarwal@laser powerinfra.com",
      { websiteHost: "laserpowerinfra.com" },
      "amitagarwal@laserpowerinfra.com",
      true,
    ],
    ["exp @gemforgings.com", {}, "exp@gemforgings.com", false],
    ["franc is@sepc.in", {}, "francis@sepc.in", false],
    [
      "franc is@sepc.in",
      { rowDomains: ["sepc.in"] },
      "francis@sepc.in",
      true,
    ],
  ])(
    "repairEmailSpaces(%j, %j) -> %j (%j confident)",
    (input, hints, value, confident) => {
      expect(repairEmailSpaces(input, hints)).toEqual({ value, confident });
    },
  );

  it("returns null when there was no whitespace to repair", () => {
    expect(repairEmailSpaces("a@b.com", {})).toBeNull();
  });
});

describe("resolveOcrVariants", () => {
  it("drops the rare domain variant when the kept domain dominates", () => {
    expect(
      resolveOcrVariants(
        ["a@lntecc.com", "a@lnteecc.com"],
        new Map([
          ["lntecc.com", 18],
          ["lnteecc.com", 1],
        ]),
      ),
    ).toEqual({
      keep: ["a@lntecc.com"],
      dropped: ["a@lnteecc.com"],
      review: false,
    });
  });

  it.each([
    [
      "frequency tie",
      ["a@x.com", "a@y.com"],
      new Map([
        ["x.com", 1],
        ["y.com", 1],
      ]),
    ],
    [
      "unknown frequency",
      ["a@x.com", "a@y.com"],
      new Map<string, number>(),
    ],
    [
      "close local parts on the same domain",
      ["amit@lntecc.com", "amlt@lntecc.com"],
      new Map([["lntecc.com", 18]]),
    ],
  ])("keeps both and flags review on %s", (_label, emails, freq) => {
    expect(resolveOcrVariants(emails, freq)).toEqual({
      keep: emails,
      dropped: [],
      review: true,
    });
  });
});
