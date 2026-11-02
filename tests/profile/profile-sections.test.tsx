import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LocationsList,
  ProfileStatusNote,
  SubsidiaryChips,
  locationAddressLines,
  mapsHref,
  profileStatusNote,
  safeHttpUrl,
} from "@/components/ProfileSections";
import type { CompanyLocationDetail } from "@/types/card";

// createElement rather than JSX: the repo has no @vitejs/plugin-react, so the
// test transform does not process JSX syntax.

const loc = (over: Partial<CompanyLocationDetail> = {}): CompanyLocationDetail => ({
  id: "l1",
  address_line1: "12 Mill Rd",
  address_line2: "Floor 3",
  city: "Pune",
  state: "Maharashtra",
  postal_code: "411001",
  country: "India",
  latitude: 18.52,
  longitude: 73.85,
  is_primary: true,
  status: "VERIFIED",
  precision: "STREET",
  ...over,
});

const list = (
  locations: CompanyLocationDetail[],
  props: { canSeeSources?: boolean; verifiedAt?: string | null } = {}
) => renderToStaticMarkup(createElement(LocationsList, { locations, ...props }));

describe("safeHttpUrl", () => {
  it("keeps http and https links", () => {
    expect(safeHttpUrl("https://acme.example/contact")).toBe("https://acme.example/contact");
    expect(safeHttpUrl("http://acme.example")).toBe("http://acme.example/");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "ftp://x.test", "not a url", ""])(
    "refuses %j",
    (url) => {
      expect(safeHttpUrl(url)).toBeNull();
    }
  );

  it("refuses null and undefined", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe("locationAddressLines / mapsHref", () => {
  it("builds street, 'City, State PIN' and country lines", () => {
    expect(locationAddressLines(loc())).toEqual(["12 Mill Rd", "Floor 3", "Pune, Maharashtra 411001", "India"]);
  });

  it("skips missing parts", () => {
    expect(locationAddressLines(loc({ address_line2: null, postal_code: null, state: null }))).toEqual([
      "12 Mill Rd",
      "Pune",
      "India",
    ]);
  });

  it("links by coordinates only for a street-level pin", () => {
    expect(mapsHref(loc())).toContain(encodeURIComponent("18.52,73.85"));
  });

  it("links by address text for an area or city pin, which is a centroid", () => {
    const href = mapsHref(loc({ precision: "AREA" }));

    expect(href).not.toContain(encodeURIComponent("18.52,73.85"));
    expect(href).toContain(encodeURIComponent("12 Mill Rd"));
  });
});

describe("LocationsList", () => {
  it("shows the primary tag, status badge, precision and address", () => {
    const html = list([loc()]);

    expect(html).toContain("Primary");
    expect(html).toContain("Verified");
    expect(html).toContain("Street-level");
    expect(html).toContain("Pune, Maharashtra 411001");
    expect(html).toContain("Open in Maps");
  });

  it("labels other offices and approximate, area-level pins", () => {
    const html = list([loc({ id: "l2", is_primary: false, status: "APPROXIMATE", precision: "CITY" })]);

    expect(html).toContain("Other location");
    expect(html).toContain("Approximate");
    expect(html).toContain("City centre");
    expect(html).not.toContain("Primary");
  });

  it("draws one card per location", () => {
    const html = list([loc(), loc({ id: "l2", is_primary: false }), loc({ id: "l3", is_primary: false })]);

    expect(html.match(/<li /g)).toHaveLength(3);
  });

  describe("provenance", () => {
    const withSource = loc({
      source_url: "https://www.acme.example/contact",
      source_urls: ["https://www.acme.example/contact", "https://dir.example/acme"],
      source_type: "OWN_SITE",
    });

    it("is not drawn for an anonymous caller, even if the data were present", () => {
      const html = list([withSource], { canSeeSources: false, verifiedAt: "2026-03-12T10:00:00.000Z" });

      expect(html).not.toContain("Company website");
      expect(html).not.toContain("acme.example/contact");
      expect(html).not.toContain("Verified on");
    });

    it("shows the source label, a safe link and the extra-source count when signed in", () => {
      const html = list([withSource], { canSeeSources: true });

      expect(html).toContain("Company website");
      expect(html).toContain('href="https://www.acme.example/contact"');
      expect(html).toContain("acme.example");
      expect(html).toContain("+1 more");
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it("never renders a non-http source URL as a link", () => {
      const html = list([loc({ source_url: "javascript:alert(1)", source_type: "DIRECTORY" })], { canSeeSources: true });

      expect(html).toContain("Directory");
      expect(html).not.toContain("javascript:");
    });

    it("shows the verified date on the primary location only", () => {
      const verifiedAt = "2026-03-12T10:00:00.000Z";
      const primary = list([withSource], { canSeeSources: true, verifiedAt });
      const other = list([{ ...withSource, is_primary: false }], { canSeeSources: true, verifiedAt });

      expect(primary).toContain("Verified on 12 Mar 2026");
      expect(other).not.toContain("Verified on");
    });
  });
});

describe("SubsidiaryChips", () => {
  it("renders one chip per match, escaping the text", () => {
    const html = renderToStaticMarkup(createElement(SubsidiaryChips, { matches: ["LASER POWER & INFRA", "CEEBUILD"] }));

    expect(html).toContain("LASER POWER &amp; INFRA");
    expect(html).toContain("CEEBUILD");
    expect(html.match(/<li /g)).toHaveLength(2);
  });
});

describe("profileStatusNote", () => {
  const note = (over: Partial<Parameters<typeof profileStatusNote>[0]> = {}) =>
    profileStatusNote({ status: "PENDING", hasLocations: false, hasSubsidiaries: false, surface: "panel", ...over });

  it("says research is queued when nothing else is known", () => {
    expect(note()).toEqual({ tone: "info", text: "Research is queued. Details will appear here when it finishes." });
  });

  it("says what is already known instead of only 'queued'", () => {
    expect(note({ hasLocations: true })?.text).toContain("We have an address for this contact");
    expect(note({ hasSubsidiaries: true })?.text).toContain("a group match");
    expect(note({ hasLocations: true, hasSubsidiaries: true })?.text).toContain("an address and a group match");
    expect(note({ hasLocations: true })?.text).toContain("Profile research is queued");
  });

  it("uses the surface in the running note", () => {
    expect(note({ status: "RUNNING" })?.text).toBe("Researching this contact. This panel updates on its own.");
    expect(note({ status: "RUNNING", surface: "page" })?.text).toBe("Researching this contact. This page updates on its own.");
  });

  it("keeps the partial and failed notes and their tones", () => {
    expect(note({ status: "PARTIAL" })).toEqual({ tone: "warn", text: "Some public details could not be verified." });
    expect(note({ status: "FAILED" })).toEqual({
      tone: "error",
      text: "Research could not find public details for this contact.",
    });
  });

  it("is silent for a finished or unknown status", () => {
    expect(note({ status: "DONE" })).toBeNull();
    expect(note({ status: null })).toBeNull();
  });
});

describe("ProfileStatusNote", () => {
  it("renders the note as a status region, and nothing when there is no note", () => {
    const shown = renderToStaticMarkup(
      createElement(ProfileStatusNote, { status: "PARTIAL", hasLocations: false, hasSubsidiaries: false, surface: "page" })
    );
    const hidden = renderToStaticMarkup(
      createElement(ProfileStatusNote, { status: "DONE", hasLocations: false, hasSubsidiaries: false, surface: "page" })
    );

    expect(shown).toContain('role="status"');
    expect(shown).toContain("Some public details could not be verified.");
    expect(hidden).toBe("");
  });
});
