import { describe, expect, it } from "vitest";

import { contactDerivedFields, dedupeKey } from "@/lib/contact";

describe("dedupeKey", () => {
  it("prefers email, lowercased", () => {
    expect(dedupeKey({ emails: ["A@B.com"], mobileNumbers: ["123"] })).toBe("email:a@b.com");
  });

  it("prefers mobile over telephone and strips spaces, + and -", () => {
    expect(dedupeKey({ mobileNumbers: ["+91 98-76"], telephoneNumbers: ["555"] })).toBe("phone:919876");
    expect(dedupeKey({ telephoneNumbers: ["+1 2-3"] })).toBe("phone:123");
  });

  it("falls back to lowercased name|company", () => {
    expect(dedupeKey({ fullName: "Jo Doe", company: "ACME" })).toBe("namecomp:jo doe|acme");
  });

  it("returns null for an empty row", () => {
    expect(dedupeKey({})).toBeNull();
    expect(dedupeKey({ emails: [], fullName: "", company: null })).toBeNull();
  });
});

describe("contactDerivedFields", () => {
  it("derives state/country and key", () => {
    const r = contactDerivedFields({ companyLocation: "Maharashtra", fullName: "X" });
    expect(r).toEqual({ state: "Maharashtra", country: "India", dedupeKey: "namecomp:x|" });
  });
});
