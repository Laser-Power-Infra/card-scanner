import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
    createElement(ProfileSlideOver, {
      contact: data,
      open,
      editMode: false,
      onClose: () => {},
      onSave: () => {},
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
});
