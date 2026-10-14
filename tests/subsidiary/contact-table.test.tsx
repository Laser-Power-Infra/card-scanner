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
