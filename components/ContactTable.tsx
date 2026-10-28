import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, User, X } from "lucide-react";
import type { CardData, FacetField, FacetValue } from "@/types/card";
import type { TextFilterField } from "@/lib/store/contactsSlice";
import MultiSelectFilter, { BLANK } from "./MultiSelectFilter";
import { getDraft, setDraft } from "@/lib/draftStorage";
import companyKeywords from "@/data/company_keywords (1).json";

const KNOWN_SUBSIDIARIES = Object.keys(companyKeywords);

type ContactTableProps = {
  contacts: CardData[];
  total?: number;
  page?: number;
  pageSize?: number;
  facets?: Partial<Record<FacetField, FacetValue[]>>;
  textFilters?: Partial<Record<TextFilterField, string>>;
  facetFilters?: Partial<Record<FacetField, string[]>>;
  onTextFilterChange?: (field: TextFilterField, value: string) => void;
  onFacetFilterChange?: (field: FacetField, values: string[]) => void;
  onPageChange?: (page: number) => void;
  onClearFilters?: () => void;
  showProfiles?: boolean;
  onViewProfile?: (contactId: string) => void;
  editMode?: boolean;
};

const NO_VALUES: string[] = [];

/** Header search box: local state, debounced 300 ms, re-syncs when `value` changes externally. */
function TextFilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange?.(text), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <input
      type="search"
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={`Search ${label.toLowerCase()}…`}
      aria-label={`Search ${label}`}
      className="w-full h-7 px-2 text-[11px] rounded-lg border border-stone-200 bg-white text-ink placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-accent-300"
    />
  );
}

export default function ContactTable({
  contacts,
  total = contacts.length,
  page = 1,
  pageSize = contacts.length || 25,
  facets = {},
  textFilters = {},
  facetFilters = {},
  onTextFilterChange,
  onFacetFilterChange,
  onPageChange,
  onClearFilters,
  showProfiles = false,
  onViewProfile,
  editMode = false,
}: ContactTableProps) {
  const [, setDraftRevision] = useState(0);

  const handleDraftChange = useCallback(
    (id: string, field: string, value: string) => {
      const existing = getDraft(id) ?? {};
      setDraft(id, { ...existing, [field]: value });
    },
    []
  );

  const facetProps = (field: FacetField) => {
    const selected = facetFilters[field] ?? NO_VALUES;
    const counts: Record<string, number> = {};
    const vals = new Set<string>(selected);
    for (const f of facets[field] ?? []) {
      counts[f.value] = f.count;
      vals.add(f.value);
    }
    vals.delete(BLANK);
    return {
      options: Array.from(vals).sort((a, b) => a.localeCompare(b)),
      counts,
      selected,
      onChange: (v: string[]) => onFacetFilterChange?.(field, v),
    };
  };

  const subsidiaryOptions = useMemo(() => {
    const set = new Set<string>([
      ...KNOWN_SUBSIDIARIES,
      ...(facets.subsidiary ?? []).map((f) => f.value).filter((v) => v !== BLANK),
    ]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [facets.subsidiary]);

  const activeFilterCount =
    Object.values(textFilters).filter((v) => v && v.length > 0).length +
    Object.values(facetFilters).filter((v) => v && v.length > 0).length;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;

  const enrichedCount = facets.profile
    ? facets.profile.find((f) => f.value === "Enriched")?.count ?? 0
    : contacts.filter((c) => c.enrichment?.status === "DONE").length;

  const textTh = (field: TextFilterField, label: string) => {
    const value = textFilters[field] ?? "";
    return (
      <th className="px-3 py-2 text-xs font-medium text-stone-500 border-b border-stone-200 border-r">
        <div className="flex items-center justify-between mb-1.5">
          <span>{label}</span>
        </div>
        <div className="normal-case font-normal text-left space-y-1">
          <TextFilterInput label={label} value={value === BLANK ? "" : value} onChange={(v) => onTextFilterChange?.(field, v)} />
          <MultiSelectFilter
            label={label}
            allLabel="Any"
            includeBlank
            options={[]}
            selected={value === BLANK ? [BLANK] : []}
            onChange={(vals) => onTextFilterChange?.(field, vals.includes(BLANK) ? BLANK : "")}
          />
        </div>
      </th>
    );
  };

  const facetTh = (title: string, filter: React.ReactNode, last = false) => (
    <th className={`px-3 py-2 text-xs font-medium text-stone-500 border-b border-stone-200${last ? "" : " border-r"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span>{title}</span>
      </div>
      <div className="normal-case font-normal text-left">{filter}</div>
    </th>
  );

  return (
    <div className="flex flex-col w-full h-full bg-white rounded-2xl shadow-soft ring-1 ring-stone-900/[0.04] overflow-hidden min-h-0">
      {/* Top Header / Info Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-stone-500">
            Showing {total === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + contacts.length, total)} of {total} records · {enrichedCount} enriched
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={() => onClearFilters?.()}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-800 cursor-pointer bg-accent-50 px-2 py-0.5 rounded-md ring-1 ring-accent-200 transition hover:bg-accent-100"
            >
              <X size={11} /> Clear filters ({activeFilterCount})
            </button>
          )}
        </div>
        <span className="text-xs text-ink/50">
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
            <col style={{ width: 200 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 230 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead className="sticky top-0 z-30">
            <tr className="bg-stone-50/95 backdrop-blur">
              {textTh("name", "Name")}
              {facetTh(
                "Company",
                <MultiSelectFilter label="Company" allLabel="All Companies" includeBlank {...facetProps("company")} />
              )}
              {facetTh(
                "Matching Subsidiaries",
                <MultiSelectFilter label="Subsidiary" allLabel="All Subsidiaries" includeBlank align="right" {...facetProps("subsidiary")} />
              )}
              {textTh("jobTitle", "Job Title")}
              {textTh("email", "Email")}
              {textTh("mobile", "Mobile")}
              {textTh("telephone", "Telephone")}
              {textTh("website", "Website")}
              {facetTh(
                "Profile",
                <MultiSelectFilter label="Profile" allLabel="All Profiles" align="right" {...facetProps("profile")} />,
                true
              )}
            </tr>
          </thead>

          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={9} className="h-32 text-center text-xs text-stone-400 italic">
                  No matching contacts found. Try adjusting your column filters.
                </td>
              </tr>
            ) : (
              contacts.map((contact, index) => {
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
                    key={contact.id ?? index}
                    className="transition-colors hover:bg-accent-50/50 [&>td]:border-b [&>td]:border-stone-100 last:[&>td]:border-b-0"
                  >
                    <td
                      className="px-3 py-2.5 text-xs font-medium text-ink border-r border-stone-100 truncate"
                      title={contact.fullName || ""}
                    >
                      {editMode ? (
                        <input
                          defaultValue={getDraft(contact.id!)?.fullName ?? contact.fullName ?? ""}
                          onBlur={(e) => handleDraftChange(contact.id!, "fullName", e.target.value)}
                          className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                        />
                      ) : (
                        contact.fullName || <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-ink border-r border-stone-100 truncate"
                      title={contact.company || ""}
                    >
                      {editMode ? (
                        <input
                          defaultValue={getDraft(contact.id!)?.company ?? contact.company ?? ""}
                          onBlur={(e) => handleDraftChange(contact.id!, "company", e.target.value)}
                          className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                        />
                      ) : (
                        contact.company || <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-ink border-r border-stone-100"
                      title={(contact.subsidiaryMatches ?? []).join(", ")}
                    >
                      {editMode && contact.id ? (
                        <div className="min-w-[9rem]">
                          <MultiSelectFilter
                            label="Subsidiary"
                            allLabel={BLANK}
                            options={subsidiaryOptions}
                            selected={
                              getDraft(contact.id)?.subsidiaryMatches ??
                              contact.subsidiaryMatches ??
                              []
                            }
                            onChange={(values) => {
                              const existing = getDraft(contact.id!) ?? {};
                              setDraft(contact.id!, {
                                ...existing,
                                subsidiaryMatches: values,
                              });
                              setDraftRevision((v) => v + 1);
                            }}
                            align="right"
                          />
                        </div>
                      ) : contact.subsidiaryMatches?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {contact.subsidiaryMatches.map((subsidiary) => (
                            <span
                              key={subsidiary}
                              className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-800"
                            >
                              {subsidiary}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-ink border-r border-stone-100 truncate"
                      title={contact.jobTitle || ""}
                    >
                      {editMode ? (
                        <input
                          defaultValue={getDraft(contact.id!)?.jobTitle ?? contact.jobTitle ?? ""}
                          onBlur={(e) => handleDraftChange(contact.id!, "jobTitle", e.target.value)}
                          className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                        />
                      ) : (
                        contact.jobTitle || <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-ink border-r border-stone-100 truncate"
                      title={email || ""}
                    >
                      {editMode ? (
                        <input
                          defaultValue={getDraft(contact.id!)?.emails?.[0] ?? email ?? ""}
                          onBlur={(e) => {
                            const newEmails = [e.target.value];
                            const existing = getDraft(contact.id!) ?? {};
                            setDraft(contact.id!, { ...existing, emails: newEmails });
                          }}
                          className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                        />
                      ) : email ? (
                        <a
                          href={`mailto:${email}`}
                          className="text-accent-600 hover:underline"
                          title={email}
                        >
                          {email}
                        </a>
                      ) : (
                        <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-ink border-r border-stone-100 truncate"
                      title={mobile || ""}
                    >
                      {editMode ? (
                        <input
                          defaultValue={getDraft(contact.id!)?.mobileNumbers?.[0] ?? mobile ?? ""}
                          onBlur={(e) => {
                            const newNums = [e.target.value];
                            const existing = getDraft(contact.id!) ?? {};
                            setDraft(contact.id!, { ...existing, mobileNumbers: newNums });
                          }}
                          className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                        />
                      ) : (
                        mobile || <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs text-ink border-r border-stone-100 truncate"
                      title={telephone || ""}
                    >
                      {editMode ? (
                        <input
                          defaultValue={getDraft(contact.id!)?.telephoneNumbers?.[0] ?? telephone ?? ""}
                          onBlur={(e) => {
                            const newNums = [e.target.value];
                            const existing = getDraft(contact.id!) ?? {};
                            setDraft(contact.id!, { ...existing, telephoneNumbers: newNums });
                          }}
                          className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                        />
                      ) : (
                        telephone || <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink border-r border-stone-100 truncate">
                      {websiteUrl ? (
                        <a
                          href={websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-accent-600 hover:text-accent-800 underline truncate"
                          title={contact.website || ""}
                        >
                          Visit <ExternalLink size={10} className="shrink-0" />
                        </a>
                      ) : (
                        <span className="text-stone-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink">
                      {showProfiles && contact.id ? (
                        <button
                          onClick={() => onViewProfile?.(contact.id!)}
                          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg ring-1 ring-stone-200 bg-white hover:ring-accent-300 hover:bg-accent-50 text-accent-800 transition active:scale-[.98]"
                        >
                          <User size={12} /> View profile
                        </button>
                      ) : (
                        <span className="text-stone-400 italic">—</span>
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
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-stone-100 shrink-0">
        <span className="font-mono text-xs text-stone-500">
          Page {currentPage} of {totalPages} · {total} rows
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange?.(currentPage - 1)}
            disabled={currentPage <= 1}
            className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg ring-1 ring-stone-200 bg-white text-ink hover:bg-stone-50 active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Prev
          </button>
          <span className="text-xs font-medium text-ink px-1">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange?.(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg ring-1 ring-stone-200 bg-white text-ink hover:bg-stone-50 active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
