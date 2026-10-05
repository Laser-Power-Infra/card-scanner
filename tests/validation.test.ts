import { describe, expect, it } from "vitest";

import { validateContact } from "@/lib/validation";

// D-02: the write path accepts an optional leading `+` followed by digits,
// which is the E.164 shape libphonenumber-js will normalize later phases to.
describe("validateContact mobileNumbers", () => {
  it("accepts E.164 with a leading +", () => {
    expect(validateContact({ mobileNumbers: ["+919999999999"] })).toBeNull();
  });

  it("accepts bare digits", () => {
    expect(validateContact({ mobileNumbers: ["9999999999"] })).toBeNull();
  });

  it("rejects whitespace inside a formatted number", () => {
    expect(
      validateContact({ mobileNumbers: ["+91 99999 99999"] })
    ).not.toBeNull();
  });

  it("rejects letters", () => {
    expect(validateContact({ mobileNumbers: ["abc"] })).not.toBeNull();
  });

  it("skips empty entries", () => {
    expect(validateContact({ mobileNumbers: [""] })).toBeNull();
  });

  it("rejects a lone + with no digits", () => {
    expect(validateContact({ mobileNumbers: ["+"] })).not.toBeNull();
  });

  it("rejects a literal ? character", () => {
    expect(validateContact({ mobileNumbers: ["+?123"] })).not.toBeNull();
  });
});
