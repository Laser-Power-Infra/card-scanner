import { describe, expect, it } from "vitest";

import {
  alnum,
  norm,
  repairMojibake,
  SOURCE_TAGS,
  stripHonorifics,
  stripSourceTag,
} from "@/scripts/cleaning/text";

describe("norm", () => {
  it.each([
    ["  hello   world  ", "hello world"],
    ["\tnew\nline", "new line"],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("norm(%j) -> %j", (input, expected) => {
    expect(norm(input as string | null | undefined)).toBe(expected);
  });
});

describe("alnum", () => {
  it.each([
    ["Daha Diop", "dahadiop"],
    ["+91 8130111500", "918130111500"],
    ["A.B-C", "abc"],
    [null, ""],
  ])("alnum(%j) -> %j", (input, expected) => {
    expect(alnum(input as string | null | undefined)).toBe(expected);
  });
});

describe("repairMojibake", () => {
  it("repairs a clean latin1/utf8 round trip", () => {
    expect(repairMojibake("cafÃ©")).toEqual({ value: "café", repaired: true });
  });

  it("leaves pure ASCII untouched", () => {
    expect(repairMojibake("Rahul Bhagwat")).toEqual({
      value: "Rahul Bhagwat",
      repaired: false,
    });
  });

  it("rejects a repair that introduces replacement characters", () => {
    // A lone high byte becomes U+FFFD on the utf8 decode; must not be accepted.
    const result = repairMojibake("ð");
    expect(result.repaired).toBe(false);
    expect(result.value).toBe("ð");
  });
});

describe("SOURCE_TAGS", () => {
  it.each([
    ["DOM Ashoka", "DOM"],
    ["DOMS Ashoka", "DOMS"],
    ["EXP Daha", "EXP"],
    ["LASER Akansha", "LASER"],
    ["T Ramesh", "T"],
  ])("matches %j at the start", (input, tag) => {
    const match = input.match(SOURCE_TAGS);
    expect(match?.[1].toUpperCase()).toBe(tag);
  });

  it("does not match T. because it is an initial", () => {
    expect("T. Ramesh Kumar".match(SOURCE_TAGS)).toBeNull();
  });
});

describe("stripSourceTag", () => {
  it.each([
    ["EXP  Daha Diop", { value: "Daha Diop", tag: "EXP" }],
    ["LASER  Akansha Singh", { value: "Akansha Singh", tag: "LASER" }],
    ["T. Ramesh Kumar", { value: "T. Ramesh Kumar", tag: null }],
    // Bare T is detected but never stripped; caller routes it to the LLM.
    ["T Ramesh Kumar", { value: "T Ramesh Kumar", tag: "T" }],
    // Remainder is not a 2-4 word person name, so the tag is returned with the
    // original value and the caller flags it for the LLM.
    [
      "DOM Ashoka Buildcon - Rahul Bhagwat",
      { value: "DOM Ashoka Buildcon - Rahul Bhagwat", tag: "DOM" },
    ],
    // Dash-only placeholder: never routed to the LLM.
    ["---", { value: "---", tag: null }],
    ["Plain Name", { value: "Plain Name", tag: null }],
  ])("stripSourceTag(%j)", (input, expected) => {
    expect(stripSourceTag(input)).toEqual(expected);
  });
});

describe("stripHonorifics", () => {
  it.each([
    ["Abn Vinod sir", "Abn Vinod"],
    ["Mr. Himanshu S. Desai", "Himanshu S. Desai"],
    ["Dr. Tarvinder Kaur", "Dr. Tarvinder Kaur"],
    // sri/shri prefix a company name, not a person honorific.
    ["Sri ram drum jamshedpur", "Sri ram drum jamshedpur"],
    ["Priya madam", "Priya"],
    ["Ravi ji", "Ravi"],
  ])("stripHonorifics(%j) -> %j", (input, expected) => {
    expect(stripHonorifics(input)).toBe(expected);
  });
});
