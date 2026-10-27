"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { RotateCcw, AlertTriangle, Download, X, Info, ScanLine, LayoutGrid, Map as MapIcon, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import UploadZone from "@/components/UploadZone";
import ScannerStage from "@/components/ScannerStage";
import ContactCard from "@/components/ContactCard";
import SearchBar from "@/components/SearchBar";
import DirectoryToolbar from "@/components/DirectoryToolbar";
import ContactTable from "@/components/ContactTable";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import ResearchAllButton from "@/components/ResearchAllButton";
import { BLANK, downloadVCard } from "@/lib/contact";
import { getAllDrafts } from "@/lib/draftStorage";
import ProfileSlideOver from "@/components/ProfileSlideOver";
import { useAppDispatch, useAppSelector } from "@/lib/store";
import {
  selectContacts,
  fetchContacts,
  scanCards,
  importSpreadsheet,
  saveAllDrafts,
  setPage,
  setPageSize,
  setSearch as setSearchQuery,
  setTextFilter,
  setFacetFilter,
  clearFilters,
  clearDuplicateInfo,
  resetScan,
} from "@/lib/store/contactsSlice";

import type { CardData } from "@/types/card";

const ContactMap = dynamic(
  () => import("@/components/ContactMap"),
  { ssr: false }
);

const EMPTY_CARD: CardData = {
  fullName: null,
  jobTitle: null,
  company: null,
  mobileNumbers: [],
  telephoneNumbers: [],
  emails: [],
  website: null,
  address: null,
  companyLocation: null,
  linkedin: null,
  otherSocials: [],
  rawNotes: null,
};

export default function Home() {
  const { data: session } = useSession();
  const dispatch = useAppDispatch();
  const { items, total, facets, query, listStatus, listError, scan, save } = useAppSelector(selectContacts);
  const { status, result, error: errorMsg, duplicateInfo } = scan;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [slideOverContact, setSlideOverContact] = useState<CardData | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table" | "map">("cards");
  const [scanSheetOpen, setScanSheetOpen] = useState(false);

  const objectUrlRef = useRef<string | null>(null);
  const cardScrollRef = useRef<HTMLDivElement | null>(null);

  // Table pages hold 25 rows, cards and map 100.
  useEffect(() => {
    const want = viewMode === "table" ? 25 : 100;
    if (query.pageSize !== want) dispatch(setPageSize(want));
  }, [viewMode, query.pageSize, dispatch]);

  // Refetch whenever the query changes (its identity changes on every reducer
  // update); aborting supersedes the in-flight request.
  useEffect(() => {
    const p = dispatch(fetchContacts());
    return () => p.abort();
  }, [query, dispatch]);

  // Only refetch on a genuine back/forward restore (bfcache), not every
  // tab focus or the initial load.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) dispatch(fetchContacts());
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [dispatch]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== query.q) dispatch(setSearchQuery(search));
    }, 200);
    return () => clearTimeout(t);
  }, [search, query.q, dispatch]);

  useEffect(() => {
    if (!duplicateInfo) return;
    const t = setTimeout(() => dispatch(clearDuplicateInfo()), 10000);
    return () => clearTimeout(t);
  }, [duplicateInfo, dispatch]);

  const stateOptions = facets.state.map((f) => f.value).filter((v) => v !== BLANK);
  const countryOptions = facets.country.map((f) => f.value).filter((v) => v !== BLANK);

  const filtersActive =
    !!query.q ||
    Object.values(query.text).some(Boolean) ||
    Object.values(query.facets).some((v) => v.length > 0);

  const handleClearFilters = useCallback(() => {
    setSearch("");
    dispatch(clearFilters());
  }, [dispatch]);

  const totalCardPages = Math.max(1, Math.ceil(total / query.pageSize));
  const currentCardPage = query.page;
  const cardPageStart = (currentCardPage - 1) * query.pageSize;
  const cardPageEnd = Math.min(cardPageStart + query.pageSize, total);

  const goToCardPage = useCallback((page: number) => {
    dispatch(setPage(page));
    cardScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [dispatch]);

  const reset = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    objectUrlRef.current = null;
    setPreviewUrl(null);
    dispatch(resetScan());
  }, [dispatch]);

  const handleFileSelected = useCallback((files: FileList) => {
    const firstFile = files[0];
    if (!firstFile) return;

    const url = URL.createObjectURL(firstFile);
    objectUrlRef.current = url;
    setPreviewUrl(url);

    dispatch(scanCards(Array.from(files)));
  }, [dispatch]);

  const handleSpreadsheetSelected = useCallback((file: File) => {
    dispatch(importSpreadsheet(file));
  }, [dispatch]);

  const openProfile = useCallback((id: string) => {
    const contact = items.find((c) => c.id === id);
    if (contact) setSlideOverContact(contact);
  }, [items]);

  const handleSaveAll = useCallback(() => {
    dispatch(saveAllDrafts());
  }, [dispatch]);

  const showSkeleton =
    listStatus === "idle" || (listStatus === "loading" && items.length === 0 && !filtersActive);
  const showEmptyState = total === 0 && !filtersActive && listStatus !== "loading";

  return (
    <main id="main" className="bg-grain min-h-[100dvh] md:h-[calc(100dvh-64px)] md:min-h-0 md:overflow-hidden">
      <div className="mx-auto flex w-full flex-col px-4 pb-28 pt-3 sm:px-6 md:h-full md:py-6 md:flex-row md:gap-8 md:overflow-hidden">
        {/* Left sidebar (desktop). On mobile the upload panel opens from the dock. */}
        <aside className="hidden shrink-0 md:block md:h-full md:w-80 md:overflow-y-auto">
          <div className="md:sticky md:top-0 md:pb-6">
            <UploadZone
              onFileSelected={handleFileSelected}
              onSpreadsheetSelected={handleSpreadsheetSelected}
            />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex min-h-0 flex-1 flex-col md:h-full md:overflow-hidden">
          {status === "scanning" && previewUrl && (
            <ScannerStage imageUrl={previewUrl} scanning />
          )}

          {listStatus === "failed" && (
            <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
              <p className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
                Couldn&apos;t load your contacts. {listError}.
              </p>
              <button
                onClick={() => dispatch(fetchContacts())}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium text-red-800 ring-1 ring-red-200 transition hover:bg-red-100 active:scale-[.98]"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Retry
              </button>
            </div>
          )}

          {showSkeleton ? (
            <div role="status" aria-label="Loading contacts" className="space-y-4">
              <div className="flex gap-2">
                <div className="skeleton h-10 w-72" />
                <div className="skeleton h-10 w-28" />
                <div className="skeleton h-10 w-28" />
              </div>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-3 rounded-2xl bg-white p-5 shadow-soft">
                    <div className="flex gap-3">
                      <div className="skeleton h-11 w-11 rounded-xl" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="skeleton h-4 w-3/4" />
                        <div className="skeleton h-3 w-1/2" />
                      </div>
                    </div>
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-5/6" />
                    <div className="skeleton h-3 w-2/3" />
                  </div>
                ))}
              </div>
            </div>
          ) : !showEmptyState ? (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="sticky top-16 z-40 -mx-4 flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200/70 bg-paper/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
                <SearchBar value={search} onChange={setSearch} compact />

                <select
                  value={query.facets.state[0] ?? ""}
                  onChange={(e) => dispatch(setFacetFilter({ field: "state", values: e.target.value ? [e.target.value] : [] }))}
                  aria-label="Filter by state"
                  className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white py-2 pl-3 pr-8 text-sm text-ink shadow-soft md:flex-none transition duration-200 hover:border-stone-300 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
                >
                  <option value="">All states</option>
                  {stateOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={query.facets.country[0] ?? ""}
                  onChange={(e) => dispatch(setFacetFilter({ field: "country", values: e.target.value ? [e.target.value] : [] }))}
                  aria-label="Filter by country"
                  className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white py-2 pl-3 pr-8 text-sm text-ink shadow-soft md:flex-none transition duration-200 hover:border-stone-300 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
                >
                  <option value="">All countries</option>
                  {countryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {filtersActive && (
                  <button
                    onClick={handleClearFilters}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-stone-500 transition hover:bg-stone-900/5 hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                    Clear filters
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="hidden md:block">
                  <DirectoryToolbar
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    total={total}
                    onScanAnother={reset}
                  />
                </div>

                {session && (
                  <button
                    onClick={() => setEditMode((v) => !v)}
                    className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      editMode
                        ? "bg-amber-600 text-white"
                        : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    {editMode ? "Done editing" : "Edit mode"}
                  </button>
                )}

                {editMode && (
                  <button
                    onClick={handleSaveAll}
                    disabled={Object.keys(getAllDrafts()).length === 0}
                    className="inline-flex items-center rounded-lg bg-accent-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-800 disabled:opacity-40"
                  >
                    Save all changes
                  </button>
                )}

                {editMode && save.error && (
                  <span role="alert" className="text-xs text-red-700">{save.error}</span>
                )}

                <ResearchAllButton />
              </div>

              {viewMode === "cards" ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Cards pagination header */}
                  <div className="flex items-center justify-between px-1 py-2 shrink-0">
                    <span className="text-xs font-medium text-stone-500">
                      Showing {total === 0 ? 0 : cardPageStart + 1}–{cardPageEnd} of {total} cards
                    </span>
                    {totalCardPages > 1 && (
                      <span className="text-xs text-stone-400">
                        Page {currentCardPage} of {totalCardPages}
                      </span>
                    )}
                  </div>

                  <div ref={cardScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4 pb-6">
                      {items.map((contact, index) => (
                        <div
                          key={contact.id ?? `card-${cardPageStart + index}`}
                          className="flex min-w-0 flex-col gap-2"
                        >
                          <ContactCard
                            data={contact}
                            profileHref={contact.id ? `/contacts/${contact.id}` : undefined}
                            editMode={editMode}
                            onEdit={() => setSlideOverContact(contact)}
                            onViewProfile={() => setSlideOverContact(contact)}
                            compact
                          />
                          <ProfileCollectionButtons contact={contact} compact />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cards pagination footer */}
                  {totalCardPages > 1 && (
                    <div className="flex items-center justify-between px-2 py-2.5 border-t border-stone-200 bg-white/80 backdrop-blur-sm rounded-b-xl shrink-0">
                      <span className="text-xs text-stone-500">
                        Page {currentCardPage} of {totalCardPages} · {total} total
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => goToCardPage(1)}
                          disabled={currentCardPage <= 1}
                          title="First page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronsLeft size={14} />
                        </button>
                        <button
                          onClick={() => goToCardPage(currentCardPage - 1)}
                          disabled={currentCardPage <= 1}
                          title="Previous page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="px-3 text-xs font-semibold text-stone-700 tabular-nums">
                          {currentCardPage} / {totalCardPages}
                        </span>
                        <button
                          onClick={() => goToCardPage(currentCardPage + 1)}
                          disabled={currentCardPage >= totalCardPages}
                          title="Next page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          onClick={() => goToCardPage(totalCardPages)}
                          disabled={currentCardPage >= totalCardPages}
                          title="Last page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronsRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : viewMode === "map" ? (
                <div className="fixed inset-x-0 bottom-0 top-16 z-30 md:static md:z-auto md:h-full md:min-h-0 md:flex-1 md:overflow-hidden">
                  <ContactMap
                    contacts={items}
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ContactTable
                    contacts={items}
                    total={total}
                    page={query.page}
                    pageSize={query.pageSize}
                    facets={facets}
                    textFilters={query.text}
                    facetFilters={query.facets}
                    onTextFilterChange={(field, value) => dispatch(setTextFilter({ field, value }))}
                    onFacetFilterChange={(field, values) => dispatch(setFacetFilter({ field, values }))}
                    onPageChange={(p) => dispatch(setPage(p))}
                    onClearFilters={handleClearFilters}
                    showProfiles
                    onViewProfile={openProfile}
                    editMode={editMode}
                  />
                </div>
              )}

              {result && (
                <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5 shadow-soft">
                  <p className="min-w-0 truncate text-sm text-stone-500">
                    Latest scan: <span className="font-medium text-ink">{result.fullName ?? result.company ?? "Unnamed contact"}</span>
                  </p>
                  <button
                    onClick={() => downloadVCard(result)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent-700 px-3.5 py-1.5 text-sm font-medium text-white transition duration-200 ease-spring hover:-transtone-y-px hover:bg-accent-800 active:scale-[.98]"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                    Save .vcf
                  </button>
                </div>
              )}
            </div>
          ) : (
            status !== "scanning" && (
              <div className="flex flex-1 animate-rise flex-col items-center justify-center py-16 text-center">
                <div className="relative mb-6 h-28 w-44" aria-hidden>
                  <div className="absolute inset-0 -rotate-6 rounded-xl bg-white shadow-soft ring-1 ring-stone-900/[0.04]" />
                  <div className="absolute inset-0 rotate-3 rounded-xl bg-white p-4 shadow-lift ring-1 ring-stone-900/[0.04]">
                    <div className="h-3 w-20 rounded bg-accent-100" />
                    <div className="mt-3 h-2 w-28 rounded bg-stone-100" />
                    <div className="mt-2 h-2 w-24 rounded bg-stone-100" />
                    <div className="mt-2 h-2 w-16 rounded bg-stone-100" />
                  </div>
                </div>
                <h2 className="font-display text-2xl font-medium text-ink">Your cardfile is empty</h2>
                <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-stone-500">
                  Scan your first business card. Name, phone, email and address
                  are pulled out for you.
                </p>
                <button
                  onClick={() => setScanSheetOpen(true)}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-medium text-white shadow-soft transition active:scale-[.98] md:hidden"
                >
                  <ScanLine className="h-4 w-4" strokeWidth={1.75} />
                  Scan a card
                </button>
                <p className="mt-5 hidden items-center gap-2 text-sm font-medium text-accent-700 md:inline-flex">
                  <ScanLine className="h-4 w-4" strokeWidth={1.75} />
                  Use the upload area on the left
                </p>
              </div>
            )
          )}

          {duplicateInfo && (
            <div role="status" className="mt-4 animate-rise rounded-xl bg-accent-50 p-4 ring-1 ring-accent-200/70">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-start gap-2 text-sm font-medium text-accent-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {duplicateInfo.message}
                </p>
                <button
                  onClick={() => dispatch(clearDuplicateInfo())}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-md p-1 text-accent-700 transition hover:bg-accent-100"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              {duplicateInfo.details.length > 0 && (
                <ul className="mt-2 space-y-1 pl-6 text-xs text-accent-800">
                  {duplicateInfo.details.map((d, i) => (
                    <li key={i}>
                      {d.row !== undefined ? `Row ${d.row + 2}: ` : ""}
                      {d.name || d.fullName || "Unknown"} — {d.matchedBy}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ProfileSlideOver
        contact={slideOverContact ?? EMPTY_CARD}
        open={!!slideOverContact}
        editMode={editMode}
        onClose={() => setSlideOverContact(null)}
        onSave={() => {
          setSlideOverContact(null);
          dispatch(fetchContacts());
        }}
      />

      {status === "error" && (
            <div role="alert" className="mx-auto mt-4 flex w-full max-w-md animate-rise flex-col items-center gap-5 rounded-2xl bg-white p-6 text-center shadow-lift">
              {previewUrl && (
                <div className="w-full overflow-hidden rounded-xl opacity-80 grayscale-[40%]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Upload that failed to scan"
                    className="w-full object-contain"
                  />
                </div>
              )}

              <div>
                <p className="flex items-center justify-center gap-2 font-medium text-red-800">
                  <AlertTriangle className="h-4 w-4" strokeWidth={2} />
                  Scan failed
                </p>
                <p className="mt-1 text-sm text-stone-500">{errorMsg}</p>
              </div>

              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-transtone-y-px hover:bg-accent-800 active:scale-[.98]"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile dock */}
      <nav
        aria-label="Directory"
        className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden"
      >
        <div className="mx-auto grid max-w-sm grid-cols-3 items-center rounded-2xl bg-white/90 p-1.5 shadow-pop ring-1 ring-stone-900/[0.06] backdrop-blur-md">
          <button
            onClick={() => setViewMode("cards")}
            aria-current={viewMode !== "map" ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition ${viewMode !== "map" ? "text-accent-800" : "text-stone-500"}`}
          >
            <LayoutGrid className="h-5 w-5" strokeWidth={1.75} />
            Cards
          </button>
          <button
            onClick={() => setScanSheetOpen(true)}
            aria-label="Scan a card"
            className="mx-auto -my-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-700 text-white shadow-lift ring-4 ring-paper transition active:scale-95"
          >
            <Plus className="h-6 w-6" strokeWidth={2} />
          </button>
          <button
            onClick={() => setViewMode("map")}
            aria-current={viewMode === "map" ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition ${viewMode === "map" ? "text-accent-800" : "text-stone-500"}`}
          >
            <MapIcon className="h-5 w-5" strokeWidth={1.75} />
            Map
          </button>
        </div>
      </nav>

      {/* Mobile scan sheet */}
      {scanSheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Scan a card">
          <div
            className="absolute inset-0 animate-[fade_0.2s_ease-out_both] bg-ink/30 backdrop-blur-[2px]"
            onClick={() => setScanSheetOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[90dvh] animate-[sheet-up_0.35s_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-y-auto rounded-t-3xl bg-paper px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-pop">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-stone-300" />
            <UploadZone
              onFileSelected={(files) => {
                setScanSheetOpen(false);
                setViewMode("cards");
                handleFileSelected(files);
              }}
              onSpreadsheetSelected={(file) => {
                setScanSheetOpen(false);
                setViewMode("cards");
                handleSpreadsheetSelected(file);
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}

