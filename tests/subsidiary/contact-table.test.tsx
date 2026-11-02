import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import ContactTable from "@/components/ContactTable";
import type { CardData } from "@/types/card";

/** Minimal valid CardData; no `id`, so draft localStorage is never consulted. */
function contact(overrides: Partial<CardData> = {}): CardData {
  return {
    fullName: "A. Person",
    jobTitle: null,
    company: "ACME Cables",
    mobileNumbers: [],
    telephoneNumbers: [],
    emails: [],
    website: null,
    address: null,
    companyLocation: null,
    linkedin: null,
    otherSocials: [],
    rawNotes: null,
    ...overrides,
  };
}

// createElement rather than JSX: the repo has no @vitejs/plugin-react, so the
// test transform does not process JSX syntax.
const render = (contacts: CardData[]) =>
  renderToStaticMarkup(createElement(ContactTable, { contacts }));

describe("ContactTable location column", () => {
  const location = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    address_line1: null,
    city: "Pune",
    state: "Maharashtra",
    country: "India",
    latitude: 18.52,
    longitude: 73.85,
    is_primary: true,
    status: "VERIFIED" as const,
    precision: "STREET" as const,
    ...over,
  });

  it("renders a Location column header", () => {
    expect(render([contact()])).toContain("Location");
  });

  it("shows the primary location as City, State", () => {
    const html = render([contact({ companyLocations: [location()] })]);

    expect(html).toContain("Pune, Maharashtra");
  });

  it("shows a +N chip when the contact has more locations", () => {
    const html = render([
      contact({
        companyLocations: [
          location(),
          location({ id: "l2", is_primary: false, city: "Surat", state: "Gujarat" }),
          location({ id: "l3", is_primary: false, city: "Nashik" }),
        ],
      }),
    ]);

    expect(html).toContain("+2");
  });

  it("falls back to the card's companyLocation text when there are no locations", () => {
    expect(render([contact({ companyLocation: "Hyderabad" })])).toContain("Hyderabad");
  });

  it("spans the empty-state row across all ten columns", () => {
    expect(render([])).toContain('colSpan="10"');
  });
});

describe("ContactTable subsidiary column", () => {
  it("renders a Matching Subsidiaries column header", () => {
    const html = render([contact()]);

    expect(html).toContain("Matching Subsidiaries");
  });

  it("renders one chip per matched subsidiary", () => {
    const html = render([
      contact({ subsidiaryMatches: ["LASER POWER & INFRA", "CEEBUILD"] }),
    ]);

    expect(html).toContain("LASER POWER &amp; INFRA");
    expect(html).toContain("CEEBUILD");
  });
});
