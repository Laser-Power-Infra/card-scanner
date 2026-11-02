// How a profile read loads a contact's CompanyLocation rows. Shared by
// GET /api/contacts/[id]/profile and the server-rendered /contacts/[id] page so
// the two cannot disagree about what a visitor is allowed to see.

import type { CompanyLocationDetail } from "@/types/card";

/** The address, quality and coordinate columns; the same data /api/contacts already serves, plus line 2 and postal code. */
const PUBLIC_LOCATION_SELECT = {
  id: true,
  address_line1: true,
  address_line2: true,
  city: true,
  state: true,
  postal_code: true,
  country: true,
  latitude: true,
  longitude: true,
  is_primary: true,
  status: true,
  precision: true,
} as const;

/**
 * The `select` for a profile read. Provenance (which scraped page an address
 * came from) is added only for a signed-in caller, and, as with enrichment, it
 * is decided in the QUERY: an anonymous read never loads those columns at all.
 * Do not "simplify" this to selecting everything and deleting fields afterwards.
 */
export function locationSelect(canSeeSources: boolean) {
  return canSeeSources
    ? { ...PUBLIC_LOCATION_SELECT, source_url: true, source_urls: true, source_type: true }
    : PUBLIC_LOCATION_SELECT;
}

/** Primary first, then the most often re-sighted. */
export function locationOrder() {
  const desc = "desc" as const;
  return [{ is_primary: desc }, { found_count: desc }];
}

/** A read that did not load locations (or a test double) yields none. */
export function toLocations(rows: CompanyLocationDetail[] | undefined | null): CompanyLocationDetail[] {
  return rows ?? [];
}
