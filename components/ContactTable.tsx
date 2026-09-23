import { useMemo, useState } from "react";
import { ExternalLink, User, X } from "lucide-react";
import type { CardData } from "@/types/card";
import MultiSelectFilter, { BLANK } from "./MultiSelectFilter";

type ContactTableProps = {
  contacts: CardData[];
  pageSize?: number;
  showProfiles?: boolean;
  onViewProfile?: (contactId: string) => void;
};

type FilterState = {
  names: string[];
  companies: string[];
  jobTitles: string[];
  emails: string[];
  mobiles: string[];
  telephones: string[];
  websites: string[];
  profiles: string[];
};

const initialFilters: FilterState = {
  names: [],
  companies: [],
  jobTitles: [],
  emails: [],
  mobiles: [],
  telephones: [],
  websites: [],
  profiles: [],
};

export default function ContactTable({
  contacts,
  pageSize = 25,
  showProfiles = false,
  onViewProfile,
}: ContactTableProps) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>(initialFilters);

  // Deduplicate contacts by primary key: email > mobile > telephone > name+company
  const deduped = useMemo(() => {
    const seen = new Map<string, CardData>();

    const makeKey = (c: CardData) => {
      const email = (c.emails && c.emails[0]) || "";
      const phone = (c.mobileNumbers && c.mobileNumbers[0]) || (c.telephoneNumbers && c.telephoneNumbers[0]) || "";
      const nameCompany = `${c.fullName || ""}|${c.company || ""}`;

      if (email) return `email:${email.toLowerCase()}`;
      if (phone) return `phone:${phone.replace(/\s|\+|-/g, "")}`;
      return `namecomp:${nameCompany.toLowerCase()}`;
    };

    for (const c of contacts) {
      const key = makeKey(c);
      if (!seen.has(key)) {
        seen.set(key, c);
      }
    }

    return Array.from(seen.values());
  }, [contacts]);

  // Master options extracted from deduped dataset
  const masterOptions = useMemo(() => {
    const getDistinct = (getter: (c: CardData) => string | undefined | null) => {
      const set = new Set<string>();
      for (const c of deduped) {
        const val = getter(c)?.trim();
        if (val) set.add(val);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    };

    return {
      names: getDistinct((c) => c.fullName),
      companies: getDistinct((c) => c.company),
      jobTitles: getDistinct((c) => c.jobTitle),
      emails: getDistinct((c) => c.emails?.[0]),
      mobiles: getDistinct((c) => c.mobileNumbers?.[0]),
      telephones: getDistinct((c) => c.telephoneNumbers?.[0]),
      websites: getDistinct((c) => c.website),
      profiles: ["Enriched", "Pending"],
    };
  }, [deduped]);

  // Filter application
  const filtered = useMemo(() => {
    return deduped.filter((c) => {
      if (filters.names.length > 0) {
        const val = c.fullName?.trim() || BLANK;
        if (!filters.names.includes(val)) return false;
      }
      if (filters.companies.length > 0) {
        const val = c.company?.trim() || BLANK;
        if (!filters.companies.includes(val)) return false;
      }
      if (filters.jobTitles.length > 0) {
        const val = c.jobTitle?.trim() || BLANK;
        if (!filters.jobTitles.includes(val)) return false;
      }
      if (filters.emails.length > 0) {
        const val = c.emails?.[0]?.trim() || BLANK;
        if (!filters.emails.includes(val)) return false;
      }
      if (filters.mobiles.length > 0) {
        const val = c.mobileNumbers?.[0]?.trim() || BLANK;
        if (!filters.mobiles.includes(val)) return false;
      }
      if (filters.telephones.length > 0) {
        const val = c.telephoneNumbers?.[0]?.trim() || BLANK;
        if (!filters.telephones.includes(val)) return false;
      }
      if (filters.websites.length > 0) {
        const val = c.website?.trim() || BLANK;
        if (!filters.websites.includes(val)) return false;
      }
      if (filters.profiles.length > 0) {
        const status = c.enrichment?.status === "DONE" ? "Enriched" : "Pending";
        if (!filters.profiles.includes(status)) return false;
      }
      return true;
    });
  }, [deduped, filters]);

  // Compute counts and cascaded options for a given field
  const getFieldMeta = (
    field: keyof FilterState,
    getter: (c: CardData) => string
  ) => {
    // Subset filtered by all criteria except this field
    const otherFiltered = deduped.filter((c) => {
      if (field !== "names" && filters.names.length > 0) {
        if (!filters.names.includes(c.fullName?.trim() || BLANK)) return false;
      }
      if (field !== "companies" && filters.companies.length > 0) {
        if (!filters.companies.includes(c.company?.trim() || BLANK)) return false;
      }
      if (field !== "jobTitles" && filters.jobTitles.length > 0) {
        if (!filters.jobTitles.includes(c.jobTitle?.trim() || BLANK)) return false;
      }
      if (field !== "emails" && filters.emails.length > 0) {
        if (!filters.emails.includes(c.emails?.[0]?.trim() || BLANK)) return false;
      }
      if (field !== "mobiles" && filters.mobiles.length > 0) {
        if (!filters.mobiles.includes(c.mobileNumbers?.[0]?.trim() || BLANK)) return false;
      }
      if (field !== "telephones" && filters.telephones.length > 0) {
        if (!filters.telephones.includes(c.telephoneNumbers?.[0]?.trim() || BLANK)) return false;
      }
      if (field !== "websites" && filters.websites.length > 0) {
        if (!filters.websites.includes(c.website?.trim() || BLANK)) return false;
      }
      if (field !== "profiles" && filters.profiles.length > 0) {
        const status = c.enrichment?.status === "DONE" ? "Enriched" : "Pending";
        if (!filters.profiles.includes(status)) return false;
      }
      return true;
    });

    const counts: Record<string, number> = {};
    const cascaded = new Set<string>();

    for (const c of otherFiltered) {
      const val = getter(c);
      counts[val] = (counts[val] || 0) + 1;
      cascaded.add(val);
    }

    return { counts, cascadedOptions: Array.from(cascaded) };
  };

  const nameMeta = useMemo(() => getFieldMeta("names", (c) => c.fullName?.trim() || BLANK), [deduped, filters]);
  const companyMeta = useMemo(() => getFieldMeta("companies", (c) => c.company?.trim() || BLANK), [deduped, filters]);
  const jobTitleMeta = useMemo(() => getFieldMeta("jobTitles", (c) => c.jobTitle?.trim() || BLANK), [deduped, filters]);
  const emailMeta = useMemo(() => getFieldMeta("emails", (c) => c.emails?.[0]?.trim() || BLANK), [deduped, filters]);
  const mobileMeta = useMemo(() => getFieldMeta("mobiles", (c) => c.mobileNumbers?.[0]?.trim() || BLANK), [deduped, filters]);
  const telephoneMeta = useMemo(() => getFieldMeta("telephones", (c) => c.telephoneNumbers?.[0]?.trim() || BLANK), [deduped, filters]);
  const websiteMeta = useMemo(() => getFieldMeta("websites", (c) => c.website?.trim() || BLANK), [deduped, filters]);
  const profileMeta = useMemo(
    () => getFieldMeta("profiles", (c) => (c.enrichment?.status === "DONE" ? "Enriched" : "Pending")),
    [deduped, filters]
  );

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).reduce((acc, curr) => acc + (curr.length > 0 ? 1 : 0), 0);
  }, [filters]);

  const updateFilter = (field: keyof FilterState, values: string[]) => {
    setFilters((prev) => ({ ...prev, [field]: values }));
    setPage(1);
  };

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  const enrichedCount = useMemo(() => {
    return filtered.filter((c) => c.enrichment?.status === "DONE").length;
  }, [filtered]);

  return (
    <div className="flex flex-col w-full h-full bg-white border border-[#e1e6eb] rounded-lg shadow-sm overflow-hidden min-h-0">
      {/* Top Header / Info Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e1e6eb] bg-[#f8f9fa] gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-[#0a2540]/70">
            Showing {total === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, total)} of {total} records
            {deduped.length !== total && ` (filtered from ${deduped.length})`} · {enrichedCount} enriched
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFilters(initialFilters);
                setPage(1);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer bg-blue-50 px-2 py-0.5 rounded border border-blue-200"
            >
              <X size={11} /> Clear filters ({activeFilterCount})
            </button>
          )}
        </div>
        <span className="text-xs text-[#0a2540]/50">
          Page {currentPage} of {totalPages}
        </span>
      </div>

      {/* Scrollable Table Area */}
      <div className="flex-1 min-h-0 w-full overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 270px)" }}>
        <table
          className="w-full text-left"
          style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: 190 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 230 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead className="sticky top-0 z-30">
            <tr className="bg-[#f4f6f8]">
              {/* Name */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Name</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Name"
                    allLabel="All Names"
                    options={masterOptions.names}
                    cascadedOptions={nameMeta.cascadedOptions}
                    counts={nameMeta.counts}
                    includeBlank
                    selected={filters.names}
                    onChange={(v) => updateFilter("names", v)}
                  />
                </div>
              </th>

              {/* Company */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Company</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Company"
                    allLabel="All Companies"
                    options={masterOptions.companies}
                    cascadedOptions={companyMeta.cascadedOptions}
                    counts={companyMeta.counts}
                    includeBlank
                    selected={filters.companies}
                    onChange={(v) => updateFilter("companies", v)}
                  />
                </div>
              </th>

              {/* Job Title */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Job Title</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Job Title"
                    allLabel="All Titles"
                    options={masterOptions.jobTitles}
                    cascadedOptions={jobTitleMeta.cascadedOptions}
                    counts={jobTitleMeta.counts}
                    includeBlank
                    selected={filters.jobTitles}
                    onChange={(v) => updateFilter("jobTitles", v)}
                  />
                </div>
              </th>

              {/* Email */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Email</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Email"
                    allLabel="All Emails"
                    options={masterOptions.emails}
                    cascadedOptions={emailMeta.cascadedOptions}
                    counts={emailMeta.counts}
                    includeBlank
                    selected={filters.emails}
                    onChange={(v) => updateFilter("emails", v)}
                  />
                </div>
              </th>

              {/* Mobile */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Mobile</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Mobile"
                    allLabel="All Mobiles"
                    options={masterOptions.mobiles}
                    cascadedOptions={mobileMeta.cascadedOptions}
                    counts={mobileMeta.counts}
                    includeBlank
                    selected={filters.mobiles}
                    onChange={(v) => updateFilter("mobiles", v)}
                  />
                </div>
              </th>

              {/* Telephone */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Telephone</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Telephone"
                    allLabel="All Telephones"
                    options={masterOptions.telephones}
                    cascadedOptions={telephoneMeta.cascadedOptions}
                    counts={telephoneMeta.counts}
                    includeBlank
                    align="right"
                    selected={filters.telephones}
                    onChange={(v) => updateFilter("telephones", v)}
                  />
                </div>
              </th>

              {/* Website */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Website</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Website"
                    allLabel="All Websites"
                    options={masterOptions.websites}
                    cascadedOptions={websiteMeta.cascadedOptions}
                    counts={websiteMeta.counts}
                    includeBlank
                    align="right"
                    selected={filters.websites}
                    onChange={(v) => updateFilter("websites", v)}
                  />
                </div>
              </th>

              {/* Profile */}
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb]">
                <div className="flex items-center justify-between mb-1.5">
                  <span>Profile</span>
                </div>
                <div className="normal-case font-normal text-left">
                  <MultiSelectFilter
                    label="Profile"
                    allLabel="All Profiles"
                    options={masterOptions.profiles}
                    cascadedOptions={profileMeta.cascadedOptions}
                    counts={profileMeta.counts}
                    align="right"
                    selected={filters.profiles}
                    onChange={(v) => updateFilter("profiles", v)}
                  />
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="h-32 text-center text-xs text-slate-400 italic">
                  No matching contacts found. Try adjusting your column filters.
                </td>
              </tr>
            ) : (
              pageItems.map((contact, index) => {
                const email = contact.emails?.[0];
                const mobile = contact.mobileNumbers?.[0];
                const telephone = contact.telephoneNumbers?.[0];
                const websiteUrl = contact.website
                  ? contact.website.startsWith("http")
                    ? contact.website
                    : `https://${contact.website}`
                  : null;

                return (
                  <tr
                    key={`${email || mobile || contact.fullName || ""}-${index}`}
                    className="hover:bg-gray-50 transition-colors border-b border-[#e1e6eb] last:border-b-0"
                  >
                    <td
                      className="px-3 py-2.5 text-xs font-medium text-[#0a2540] border-r border-[#e1e6eb] truncate"
                      title={contact.fullName || ""}
                    >
                      {contact.fullName || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate"
                      title={contact.company || ""}
                    >
                      {contact.company || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate"
                      title={contact.jobTitle || ""}
                    >
                      {contact.jobTitle || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate"
                      title={email || ""}
                    >
                      {email ? (
                        <a
                          href={`mailto:${email}`}
                          className="text-blue-600 hover:underline"
                          title={email}
                        >
                          {email}
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate"
                      title={mobile || ""}
                    >
                      {mobile || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate"
                      title={telephone || ""}
                    >
                      {telephone || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate">
                      {websiteUrl ? (
                        <a
                          href={websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-800 underline truncate"
                          title={contact.website || ""}
                        >
                          Visit <ExternalLink size={10} className="shrink-0" />
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#0a2540]">
                      {showProfiles && contact.id && contact.enrichment?.status === "DONE" ? (
                        <button
                          onClick={() => onViewProfile?.(contact.id!)}
                          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold rounded border border-[#0f62fe]/20 bg-white hover:bg-[#f0f4ff] text-[#0f62fe] transition-colors"
                        >
                          <User size={12} /> View Profile
                        </button>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Integrated Pagination Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#e1e6eb] bg-[#f8f9fa] shrink-0">
        <span className="text-xs text-[#0a2540]/60">
          Page {currentPage} of {totalPages} · {total} rows
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded border border-[#e1e6eb] bg-white text-[#0a2540] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
          >
            Prev
          </button>
          <span className="text-xs font-medium text-[#0a2540] px-1">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded border border-[#e1e6eb] bg-white text-[#0a2540] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}