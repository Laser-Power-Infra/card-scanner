import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Provider } from "react-redux";
import { makeStore } from "@/lib/store";
import ProfileSlideOver from "@/components/ProfileSlideOver";
import type { CardData } from "@/types/card";

// The drawer embeds the developer-only collection buttons, which read the
// client session. Static rendering has no SessionProvider, so pin it anonymous.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

function card(overrides: Partial<CardData> = {}): CardData {
  return {
    id: "c1",
    fullName: "A. Person",
    jobTitle: "Engineer",
    company: "ACME",
    mobileNumbers: ["+91 90000 00000"],
    telephoneNumbers: [],
    emails: ["a@example.com"],
    website: null,
    address: null,
    companyLocation: "Kolkata",
    linkedin: null,
    otherSocials: [],
    rawNotes: null,
    ...overrides,
  };
}

const render = (open: boolean, data: CardData = card()) =>
  renderToStaticMarkup(
    createElement(Provider, {
      store: makeStore(),
      children: createElement(ProfileSlideOver, {
        contact: data,
        open,
        editMode: false,
        onClose: () => {},
        onSave: async () => {},
      }),
    })
  );

describe("ProfileSlideOver", () => {
  it("renders nothing while closed", () => {
    expect(render(false)).toBe("");
  });

  it("renders the drawer with a Back control and the contact identity", () => {
    const html = render(true);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Back");
    expect(html).toContain('aria-label="Close profile"');
    expect(html).toContain("A. Person");
    expect(html).toContain("Engineer");
    expect(html).toContain("ACME");
    expect(html).toContain("Kolkata");
  });

  it("renders quick actions from the card details", () => {
    const html = render(true);

    expect(html).toContain("Call");
    expect(html).toContain("Email");
    expect(html).toContain('href="tel:+91 90000 00000"');
    expect(html).toContain('href="mailto:a@example.com"');
  });

  it("paints matched subsidiaries from the card it was opened with", () => {
    const html = render(true, card({ subsidiaryMatches: ["LASER POWER & INFRA", "CEEBUILD"] }));

    expect(html).toContain("Matching subsidiaries");
    expect(html).toContain("LASER POWER &amp; INFRA");
    expect(html).toContain("CEEBUILD");
  });

  it("paints the locations the list payload already carries, primary label in the header", () => {
    const summary = (over: Record<string, unknown>) => ({
      id: "l1",
      address_line1: "12 Mill Rd",
      city: "Pune",
      state: "Maharashtra",
      country: "India",
      latitude: 18.52,
      longitude: 73.85,
      is_primary: true,
      status: "APPROXIMATE" as const,
      precision: "AREA" as const,
      ...over,
    });
    const html = render(
      true,
      card({
        companyLocation: "Kolkata",
        companyLocations: [summary({}), summary({ id: "l2", is_primary: false, city: "Surat", state: "Gujarat" })],
      })
    );

    expect(html).toContain("Locations (2)");
    expect(html).toContain("Primary");
    expect(html).toContain("Other location");
    // The worker-found primary outranks the card's own "Kolkata" hint in the header.
    expect(html).toContain("Pune, Maharashtra");
    expect(html).toContain("12 Mill Rd");
  });

  it("opens cleanly from a map stub that has only id, name and company", () => {
    const html = render(
      true,
      card({
        id: "c9",
        fullName: "Priya",
        company: "TechVista",
        jobTitle: null,
        mobileNumbers: [],
        emails: [],
        companyLocation: null,
      })
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Priya");
    expect(html).toContain("TechVista");
    expect(html).not.toContain("Matching subsidiaries");
    expect(html).not.toContain("Locations");
  });
});
