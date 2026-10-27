import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CardData, ContactsPageResponse, FacetField, FacetValue } from "@/types/card";
import type { RootState } from "./index";
import { createAppAsyncThunk } from "./withTypes";

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

export interface ContactsState {
  items: CardData[];
  total: number;
  facets: Record<FacetField, FacetValue[]>;
  query: ContactsQuery;
  listStatus: "idle" | "loading" | "succeeded" | "failed";
  listError: string | null;
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
};

export function buildContactsQuery(query: ContactsQuery): URLSearchParams {
  const p = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.q) p.set("q", query.q);
  for (const [k, v] of Object.entries(query.text)) if (v) p.set(k, v);
  for (const [k, vals] of Object.entries(query.facets)) for (const v of vals) p.append(k, v);
  return p;
}

export const fetchContacts = createAppAsyncThunk(
  "contacts/fetch",
  async (_: void, { getState, signal, rejectWithValue }) => {
    const qs = buildContactsQuery(getState().contacts.query).toString();
    const res = await fetch("/api/contacts?" + qs, { signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return rejectWithValue(body.error ?? `Request failed (${res.status})`);
    }
    return (await res.json()) as ContactsPageResponse;
  },
);

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
        s.items = a.payload.items;
        s.total = a.payload.total;
        s.facets = a.payload.facets;
        s.listStatus = "succeeded";
      })
      .addCase(fetchContacts.rejected, (s, a) => {
        if (a.meta.aborted) return; // superseded by a newer request
        s.listStatus = "failed";
        s.listError = a.payload ?? a.error.message ?? "Request failed";
      });
  },
});

export const { setPage, setPageSize, setSearch, setTextFilter, setFacetFilter, clearFilters } = slice.actions;
export default slice.reducer;

export const selectContacts = (s: RootState) => s.contacts;
export const selectQuery = (s: RootState) => s.contacts.query;
