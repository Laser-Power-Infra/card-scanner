import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishProfileCollectionTask } from "@/lib/queue/profileCollection";
import { publishContactEnrichment } from "@/lib/queue/contactEnrichment";

const CONTACT = {
  id: "c1",
  fullName: "Ada Lovelace",
  jobTitle: "Countess",
  company: "Analytical Engines",
  mobileNumbers: ["+919999999999"],
  telephoneNumbers: [],
  emails: ["ada@example.com"],
  website: null,
  address: null,
  companyLocation: null,
  linkedin: null,
};

describe("publishContactEnrichment", () => {
  beforeEach(() => {
    vi.mocked(publishProfileCollectionTask).mockClear();
    vi.mocked(publishProfileCollectionTask).mockResolvedValue(true);
  });

  it("publishes research before address", async () => {
    const result = await publishContactEnrichment(CONTACT);

    expect(result).toEqual({ research: true, address: true });
    const tags = vi.mocked(publishProfileCollectionTask).mock.calls.map(([payload]) => payload.tag);
    expect(tags).toEqual(["research", "address"]);
    for (const [payload] of vi.mocked(publishProfileCollectionTask).mock.calls) {
      expect(payload.contactId).toBe("c1");
    }
  });
});
