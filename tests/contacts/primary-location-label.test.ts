import { describe, expect, it } from "vitest";

import { primaryLocationLabel } from "@/lib/contact";

const loc = (over: Partial<NonNullable<Parameters<typeof primaryLocationLabel>[0]["companyLocations"]>[number]> = {}) => ({
  city: "Pune",
  state: "Maharashtra",
  country: "India",
  is_primary: false,
  status: "VERIFIED",
  precision: "STREET",
  ...over,
});

describe("primaryLocationLabel", () => {
  it("shows the primary location as City, State", () => {
    const r = primaryLocationLabel({
      companyLocations: [loc({ city: "Surat", state: "Gujarat" }), loc({ is_primary: true })],
    });

    expect(r.label).toBe("Pune, Maharashtra");
    expect(r.extra).toBe(1);
    expect(r.detail).toBe("Verified · street precision");
  });

  it("uses the first location when none is flagged primary", () => {
    expect(primaryLocationLabel({ companyLocations: [loc({ city: "Surat", state: "Gujarat" })] }).label).toBe(
      "Surat, Gujarat"
    );
  });

  it("uses the country when the location has no state", () => {
    expect(primaryLocationLabel({ companyLocations: [loc({ is_primary: true, state: null })] }).label).toBe(
      "Pune, India"
    );
  });

  it("describes an unverified primary's status and precision for the tooltip", () => {
    const r = primaryLocationLabel({
      companyLocations: [loc({ is_primary: true, status: "APPROXIMATE", precision: "CITY" })],
    });

    expect(r.detail).toBe("Approximate · city precision");
  });

  it("falls back to the card's own text when there are no locations", () => {
    expect(primaryLocationLabel({ companyLocations: [], companyLocation: " Hyderabad " })).toMatchObject({
      label: "Hyderabad",
      extra: 0,
    });
    expect(primaryLocationLabel({ companyLocation: null, address: "1 Main St" }).label).toBe("1 Main St");
  });

  it("falls back to card text when the location row has no usable place, keeping the +N count", () => {
    const r = primaryLocationLabel({
      companyLocation: "Chennai",
      companyLocations: [loc({ is_primary: true, city: null, state: null, country: null }), loc()],
    });

    expect(r.label).toBe("Chennai");
    expect(r.extra).toBe(1);
  });

  it("is empty when there is nothing to show", () => {
    expect(primaryLocationLabel({})).toMatchObject({ label: null, extra: 0, detail: null });
  });
});
