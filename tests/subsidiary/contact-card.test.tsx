import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import ContactCard from "@/components/ContactCard";
import type { CardData } from "@/types/card";

/** Minimal valid CardData; no `id`, so draft localStorage is never consulted. */
function card(overrides: Partial<CardData> = {}): CardData {
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
const render = (data: CardData) =>
  renderToStaticMarkup(createElement(ContactCard, { data }));

describe("ContactCard subsidiary chips", () => {
  it("renders one chip per matched subsidiary", () => {
    const html = render(card({ subsidiaryMatches: ["LASER POWER & INFRA", "CEEBUILD"] }));

    expect(html).toContain('aria-label="Matching subsidiaries"');
    expect(html).toContain("LASER POWER &amp; INFRA");
    expect(html).toContain("CEEBUILD");
  });

  it("renders only two chips plus a counter for the rest", () => {
    const html = render(
      card({ subsidiaryMatches: ["LASER POWER & INFRA", "CEEBUILD", "THIRD", "FOURTH"] })
    );

    expect(html).toContain("LASER POWER &amp; INFRA");
    expect(html).toContain("CEEBUILD");
    expect(html).not.toContain("THIRD");
    expect(html).toContain("+2");
  });

  it("omits the chip list when nothing matched", () => {
    const html = render(card());

    expect(html).not.toContain("Matching subsidiaries");
  });
});
