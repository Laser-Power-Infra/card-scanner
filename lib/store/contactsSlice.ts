import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CardData, ContactsPageResponse, FacetField, FacetValue, ScanResponse } from "@/types/card";
import type { RootState } from "./index";
import { createAppAsyncThunk } from "./withTypes";
import { resizeImageFile } from "@/lib/resizeImage";
import { MAX_CARD_PHOTOS } from "@/lib/scan";
import { getAllDrafts, clearDraft } from "@/lib/draftStorage";
import { validateContact } from "@/lib/validation";
import type { ProfileTag } from "@/lib/queue/config";
import {
  publishProfileCollection,
  researchAllContacts,
  type ResearchAllMode,
} from "@/app/actions/profile-collection";

export type TextFilterField = "name" | "jobTitle" | "email" | "mobile" | "telephone" | "website";

const FACET_FIELDS: FacetField[] = ["company", "subsidiary", "profile", "state", "country"];
const TEXT_FIELDS: TextFilterField[] = ["name", "jobTitle", "email", "mobile", "telephone", "website"];

export interface ContactsQuery {
  page: number;
  pageSize: number;
  q: string;
  text: Record<TextFilterField, string>;
  facets: Record<FacetField, string[]>;
}

export interface DuplicateDetail {
  row?: number;
  name?: string;
  fullName?: string | null;
  matchedBy?: string;
}
export interface DuplicateInfo {
  message: string;
  details: DuplicateDetail[];
}

export interface ContactsState {
  items: CardData[];
  total: number;
  facets: Record<FacetField, FacetValue[]>;
  query: ContactsQuery;
  listStatus: "idle" | "loading" | "succeeded" | "failed";
  listError: string | null;
  loadedPages: number;
  loadingMore: boolean;
  scan: {
    status: "idle" | "scanning" | "done" | "error";
    error: string | null;
    result: CardData | null;
    duplicateInfo: DuplicateInfo | null;
    /** A successful scan persisted a row that was not already visible. */
    newContact: boolean;
    /** Finished-at timestamp; the toast effect keys off this so a re-render
     *  (or a bfcache restore) cannot replay the last notification. */
    finishedAt: number | null;
    /** One-line summary of a completed scan/import, shown as a toast. */
    notice: { tone: "success" | "warning"; message: string } | null;
  };
  save: { status: "idle" | "saving" | "failed"; error: string | null };
  queueing: Record<string, ProfileTag>;
  queueErrors: Record<string, string>;
  research: { status: "idle" | "loading"; message: string | null; error: string | null };
}

const emptyText = (): Record<TextFilterField, string> =>
  Object.fromEntries(TEXT_FIELDS.map((f) => [f, ""])) as Record<TextFilterField, string>;
const emptyFacets = <T>(): Record<FacetField, T[]> =>
  Object.fromEntries(FACET_FIELDS.map((f) => [f, []])) as unknown as Record<FacetField, T[]>;

const initialState: ContactsState = {
  items: [],
  total: 0,
  facets: emptyFacets<FacetValue>(),
  query: { page: 1, pageSize: 25, q: "", text: emptyText(), facets: emptyFacets<string>() },
  listStatus: "idle",
  listError: null,
  loadedPages: 1,
  loadingMore: false,
  scan: {
    status: "idle",
    error: null,
    result: null,
    duplicateInfo: null,
    newContact: false,
    finishedAt: null,
    notice: null,
  },
  save: { status: "idle", error: null },
  queueing: {},
  queueErrors: {},
  research: { status: "idle", message: null, error: null },
};

export function buildContactsQuery(
  query: ContactsQuery,
  paging: { page: number; pageSize: number } = query,
): URLSearchParams {
  const p = new URLSearchParams({ page: String(paging.page), pageSize: String(paging.pageSize) });
  if (query.q) p.set("q", query.q);
  for (const [k, v] of Object.entries(query.text)) if (v) p.set(k, v);
  for (const [k, vals] of Object.entries(query.facets)) for (const v of vals) p.append(k, v);
  return p;
}

async function requestContacts(qs: string, signal: AbortSignal) {
  const res = await fetch("/api/contacts?" + qs, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body.error as string | undefined) ?? `Request failed (${res.status})` };
  }
  return { data: (await res.json()) as ContactsPageResponse };
}

export const fetchContacts = createAppAsyncThunk(
  "contacts/fetch",
  async (arg: { keepLoaded?: boolean } | void, { getState, signal, rejectWithValue }) => {
    const { query, loadedPages } = getState().contacts;
    // ponytail: the server caps pageSize at 200, so a keepLoaded refresh beyond 8 loaded
    // pages truncates; upgrade = per-page refetch.
    const paging =
      arg?.keepLoaded && loadedPages > 1
        ? { page: 1, pageSize: query.pageSize * loadedPages }
        : query;
    const r = await requestContacts(buildContactsQuery(query, paging).toString(), signal);
    return r.data ?? rejectWithValue(r.error);
  },
);

const STALE = "stale";

export const loadMoreContacts = createAppAsyncThunk(
  "contacts/loadMore",
  async (_: void, { getState, signal, rejectWithValue }) => {
    const { query, loadedPages } = getState().contacts;
    const qs = buildContactsQuery(query, { page: loadedPages + 1, pageSize: query.pageSize }).toString();
    const r = await requestContacts(qs, signal);
    // Filters changed while this page was in flight: its rows belong to the old query.
    if (getState().contacts.query !== query) return rejectWithValue(STALE);
    return r.data ?? rejectWithValue(r.error);
  },
);

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export const scanCards = createAppAsyncThunk(
  "contacts/scanCards",
  async (files: File[], { dispatch, rejectWithValue }) => {
    try {
      const photos = files.slice(0, MAX_CARD_PHOTOS);

      if (photos.length === 0) {
        throw new Error("No photo was selected.");
      }

      const formData = new FormData();

      for (const file of photos) {
        const uploadFile = file.type.startsWith("image/") ? await resizeImageFile(file) : file;
        formData.append("images", uploadFile);
      }

      const res = await fetch("/api/scan", { method: "POST", body: formData });
      const json: ScanResponse = await res.json();

      if (!json.success || !json.data) {
        throw new Error(json.error || "No contact information could be extracted.");
      }

      const persisted = Array.isArray(json.data) ? json.data : [json.data];
      const result = persisted[0];

      if (!result) {
        throw new Error("No contact information could be extracted.");
      }

      const duplicateInfo: DuplicateInfo | null =
        json.alreadyExists && result
          ? {
              message: `Duplicate skipped (${result.fullName ?? "Unknown"}). Data merged.`,
              details: [{ name: result.fullName ?? "Unknown", matchedBy: json.matchedBy ?? "existing contact" }],
            }
          : null;
      const newIds = json.alreadyExists
        ? []
        : persisted.filter((row) => row.id).map((row) => row.id as string);

      await dispatch(fetchContacts({ keepLoaded: true }));
      return { result, duplicateInfo, persisted, newIds };
    } catch (err) {
      return rejectWithValue(errMsg(err, "The card couldn't be read. Try a sharper, well-lit photo."));
    }
  },
);

export const importSpreadsheet = createAppAsyncThunk(
  "contacts/importSpreadsheet",
  async (file: File, { dispatch, rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/scan", { method: "POST", body: formData });
      const json: ScanResponse = await res.json();

      if (!json.success || !json.data) throw new Error(json.error || "Failed to import spreadsheet.");

      const imported = Array.isArray(json.data) ? json.data : [json.data];
      const duplicates = (json.duplicates ?? []) as unknown as DuplicateDetail[];

      if (imported.length === 0 && duplicates.length === 0) {
        throw new Error("No valid rows found. Name and company are required per row.");
      }

      const duplicateInfo: DuplicateInfo | null = duplicates.length
        ? {
            message: `${imported.length} new contact${imported.length !== 1 ? "s" : ""} imported. ${duplicates.length} duplicate${duplicates.length !== 1 ? "s" : ""} skipped.`,
            details: duplicates,
          }
        : null;

      await dispatch(fetchContacts({ keepLoaded: true }));
      return {
        result: imported[0] ?? null,
        duplicateInfo,
        persisted: imported,
        newIds: imported.filter((c) => c.id).map((c) => c.id as string),
      };
    } catch (err) {
      return rejectWithValue(errMsg(err, "Import failed."));
    }
  },
);

export const saveAllDrafts = createAppAsyncThunk(
  "contacts/saveAllDrafts",
  async (_: void, { dispatch, rejectWithValue }) => {
    const drafts = getAllDrafts();
    const updates = Object.entries(drafts).map(([id, changes]) => ({ id, changes }));

    for (const { id, changes } of updates) {
      const error = validateContact(changes);
      if (error) return rejectWithValue(`Contact ${id}: ${error}`);
    }

    try {
      const res = await fetch("/api/contacts/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return rejectWithValue(body.error ?? "Save failed");
      }
    } catch (err) {
      return rejectWithValue(errMsg(err, "Save failed"));
    }
    for (const id of Object.keys(drafts)) clearDraft(id);
    await dispatch(fetchContacts({ keepLoaded: true }));
  },
);

export const updateContact = createAppAsyncThunk(
  "contacts/updateContact",
  async ({ id, changes }: { id: string; changes: Record<string, unknown> }, { dispatch, rejectWithValue }) => {
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return rejectWithValue(data.error ?? "Save failed");
      }
    } catch {
      return rejectWithValue("Save failed");
    }
    clearDraft(id);
    await dispatch(fetchContacts({ keepLoaded: true }));
  },
);

export const queueProfileCollection = createAppAsyncThunk(
  "contacts/queueProfileCollection",
  async ({ tag, contact }: { tag: ProfileTag; contact: CardData }, { rejectWithValue }) => {
    try {
      const result = await publishProfileCollection({ tag, contact, contactId: contact.id });
      if (!result.success || !result.queued) return rejectWithValue(result.error || "Failed to queue task.");
    } catch (err) {
      return rejectWithValue(errMsg(err, "Failed to queue task."));
    }
  },
);

export const researchAll = createAppAsyncThunk(
  "contacts/researchAll",
  async (mode: ResearchAllMode, { rejectWithValue }) => {
    try {
      const result = await researchAllContacts(mode);
      if (!result.success) return rejectWithValue(result.error || "Failed to queue research tasks.");
      if (result.total === 0) return "No profiles found to queue.";
      return (
        `Queued ${result.queued} of ${result.total} profiles` +
        (result.failed > 0 ? ` (${result.failed} failed)` : "")
      );
    } catch (err) {
      return rejectWithValue(errMsg(err, "Failed to queue research tasks."));
    }
  },
);

/**
 * Put server-persisted rows at the top of the loaded page. They arrive only
 * after the write committed, so this is a post-success state update, not an
 * optimistic insert: nothing here can appear before the database has the row.
 *
 * A row that is already on screen is refreshed in place — that is the merge
 * path, and it must not jump position. Returns true only when at least one row
 * is genuinely new, which is the signal to reset filters and paging so the new
 * contact cannot stay hidden behind them.
 */
function insertPersisted(
  s: ContactsState,
  incoming: CardData[] | undefined,
  newIds: string[] | undefined,
): boolean {
  const rows = (incoming ?? []).filter((c): c is CardData & { id: string } => Boolean(c.id));
  if (rows.length === 0) return false;

  const byId = new Map(rows.map((c) => [c.id, c]));
  const visible = new Set(s.items.map((c) => c.id).filter((id): id is string => Boolean(id)));
  const created = new Set(newIds ?? []);
  const fresh = rows.filter((c) => created.has(c.id) && !visible.has(c.id));

  // Merged duplicates keep their position but take the server's fresh values.
  s.items = s.items.map((c) => (c.id && byId.get(c.id)) || c);

  if (fresh.length === 0) return false;

  s.items = [...fresh, ...s.items];
  s.total = Math.max(s.total, s.items.length);
  s.query.page = 1;
  s.query.q = "";
  s.query.text = emptyText();
  s.query.facets = emptyFacets<string>();

  return true;
}

const slice = createSlice({
  name: "contacts",
  initialState,
  reducers: {
    setPage(s, a: PayloadAction<number>) {
      s.query.page = a.payload;
    },
    setPageSize(s, a: PayloadAction<number>) {
      s.query.pageSize = a.payload;
      s.query.page = 1;
    },
    setSearch(s, a: PayloadAction<string>) {
      s.query.q = a.payload;
      s.query.page = 1;
    },
    setTextFilter(s, a: PayloadAction<{ field: TextFilterField; value: string }>) {
      s.query.text[a.payload.field] = a.payload.value;
      s.query.page = 1;
    },
    setFacetFilter(s, a: PayloadAction<{ field: FacetField; values: string[] }>) {
      s.query.facets[a.payload.field] = a.payload.values;
      s.query.page = 1;
    },
    clearDuplicateInfo(s) {
      s.scan.duplicateInfo = null;
    },
    resetScan(s) {
      s.scan.status = "idle";
      s.scan.error = null;
      s.scan.result = null;
      s.scan.newContact = false;
      s.scan.finishedAt = null;
      s.scan.notice = null;
    },
    clearFilters(s) {
      s.query.q = "";
      s.query.text = emptyText();
      s.query.facets = emptyFacets<string>();
      s.query.page = 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchContacts.pending, (s) => {
        s.listStatus = "loading";
        s.listError = null;
      })
      .addCase(fetchContacts.fulfilled, (s, a) => {
        if (!a.meta.arg?.keepLoaded) s.loadedPages = 1;
        s.items = a.payload.items;
        s.total = a.payload.total;
        s.facets = a.payload.facets;
        s.listStatus = "succeeded";
      })
      .addCase(fetchContacts.rejected, (s, a) => {
        if (a.meta.aborted) return; // superseded by a newer request
        s.listStatus = "failed";
        s.listError = a.payload ?? a.error.message ?? "Request failed";
      })
      .addCase(loadMoreContacts.pending, (s) => {
        s.loadingMore = true;
      })
      .addCase(loadMoreContacts.fulfilled, (s, a) => {
        const have = new Set(s.items.map((c) => c.id));
        s.items.push(...a.payload.items.filter((c) => !have.has(c.id)));
        s.total = a.payload.total;
        s.facets = a.payload.facets;
        s.loadedPages += 1;
        s.loadingMore = false;
      })
      .addCase(loadMoreContacts.rejected, (s, a) => {
        s.loadingMore = false;
        if (a.meta.aborted || a.payload === STALE) return;
        s.listError = a.payload ?? a.error.message ?? "Request failed";
      })
      .addCase(scanCards.pending, (s) => {
        s.scan.status = "scanning";
        s.scan.error = null;
        s.scan.newContact = false;
        s.scan.finishedAt = null;
        s.scan.notice = null;
      })
      .addCase(scanCards.fulfilled, (s, a) => {
        s.scan.status = "done";
        s.scan.result = a.payload.result;
        s.scan.duplicateInfo = a.payload.duplicateInfo;
        s.scan.newContact = insertPersisted(s, a.payload.persisted, a.payload.newIds);
        s.scan.notice = null;
        s.scan.finishedAt = Date.now();
      })
      .addCase(scanCards.rejected, (s, a) => {
        s.scan.status = "error";
        s.scan.error = a.payload ?? a.error.message ?? "The card couldn't be read. Try a sharper, well-lit photo.";
        s.scan.finishedAt = Date.now();
      })
      .addCase(importSpreadsheet.pending, (s) => {
        s.scan.status = "scanning";
        s.scan.error = null;
        s.scan.newContact = false;
        s.scan.finishedAt = null;
        s.scan.notice = null;
      })
      .addCase(importSpreadsheet.fulfilled, (s, a) => {
        s.scan.status = "done";
        s.scan.result = a.payload.result;
        s.scan.duplicateInfo = a.payload.duplicateInfo;
        s.scan.newContact = insertPersisted(s, a.payload.persisted, a.payload.newIds);
        const imported = a.payload.persisted.length;
        s.scan.notice = a.payload.duplicateInfo
          ? { tone: "warning", message: a.payload.duplicateInfo.message }
          : {
              tone: "success",
              message: `${imported} contact${imported !== 1 ? "s" : ""} imported.`,
            };
        s.scan.finishedAt = Date.now();
      })
      .addCase(importSpreadsheet.rejected, (s, a) => {
        s.scan.status = "error";
        s.scan.error = a.payload ?? a.error.message ?? "Import failed.";
        s.scan.finishedAt = Date.now();
      })
      .addCase(saveAllDrafts.pending, (s) => {
        s.save.status = "saving";
        s.save.error = null;
      })
      .addCase(saveAllDrafts.fulfilled, (s) => {
        s.save.status = "idle";
      })
      .addCase(saveAllDrafts.rejected, (s, a) => {
        s.save.status = "failed";
        s.save.error = a.payload ?? a.error.message ?? "Save failed";
      })
      .addCase(queueProfileCollection.pending, (s, a) => {
        const id = a.meta.arg.contact.id ?? "";
        s.queueing[id] = a.meta.arg.tag;
        delete s.queueErrors[id];
      })
      .addCase(queueProfileCollection.fulfilled, (s, a) => {
        delete s.queueing[a.meta.arg.contact.id ?? ""];
      })
      .addCase(queueProfileCollection.rejected, (s, a) => {
        const id = a.meta.arg.contact.id ?? "";
        delete s.queueing[id];
        s.queueErrors[id] = a.payload ?? a.error.message ?? "Failed to queue task.";
      })
      .addCase(researchAll.pending, (s) => {
        s.research = { status: "loading", message: null, error: null };
      })
      .addCase(researchAll.fulfilled, (s, a) => {
        s.research = { status: "idle", message: a.payload, error: null };
      })
      .addCase(researchAll.rejected, (s, a) => {
        s.research = { status: "idle", message: null, error: a.payload ?? a.error.message ?? "Failed to queue research tasks." };
      });
  },
});

export const { clearDuplicateInfo, resetScan, setPage, setPageSize, setSearch, setTextFilter, setFacetFilter, clearFilters } = slice.actions;
export default slice.reducer;

export const selectContacts = (s: RootState) => s.contacts;
export const selectQuery = (s: RootState) => s.contacts.query;
