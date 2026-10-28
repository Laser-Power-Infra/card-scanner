import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/profile-collection", () => ({
  publishProfileCollection: vi.fn(),
  researchAllContacts: vi.fn(),
}));
vi.mock("@/lib/draftStorage", () => ({ getAllDrafts: () => ({}), clearDraft: vi.fn() }));
import { makeStore } from "@/lib/store";
import {
  buildContactsQuery,
  clearFilters,
  fetchContacts,
  loadMoreContacts,
  setFacetFilter,
  setPage,
  setPageSize,
  setSearch,
  setTextFilter,
  updateContact,
} from "@/lib/store/contactsSlice";
import type { ContactsPageResponse } from "@/types/card";

const facets = { company: [], subsidiary: [], profile: [], state: [], country: [] };

describe("contactsSlice", () => {
  it("filter reducers reset page to 1", () => {
    const store = makeStore();
    for (const action of [
      setPageSize(50),
      setSearch("x"),
      setTextFilter({ field: "name", value: "a" }),
      setFacetFilter({ field: "company", values: ["Acme"] }),
      clearFilters(),
    ]) {
      store.dispatch(setPage(4));
      store.dispatch(action);
      expect(store.getState().contacts.query.page).toBe(1);
    }
    expect(store.getState().contacts.query.q).toBe("");
  });

  it("buildContactsQuery repeats facets and skips empties", () => {
    const store = makeStore();
    store.dispatch(setFacetFilter({ field: "state", values: ["KA", "TN"] }));
    store.dispatch(setTextFilter({ field: "email", value: "@a.com" }));
    const p = buildContactsQuery(store.getState().contacts.query);
    expect(p.getAll("state")).toEqual(["KA", "TN"]);
    expect(p.get("email")).toBe("@a.com");
    expect(p.has("q")).toBe(false);
    expect(p.has("name")).toBe(false);
    expect(p.has("company")).toBe(false);
  });

  it("fulfilled sets items/total/facets; aborted rejection is ignored", () => {
    const store = makeStore();
    const payload = { items: [{ id: "1" }], total: 1, page: 1, pageSize: 25, facets } as unknown as ContactsPageResponse;
    store.dispatch(fetchContacts.pending("r1"));
    expect(store.getState().contacts.listStatus).toBe("loading");
    store.dispatch(fetchContacts.fulfilled(payload, "r1"));
    const done = store.getState().contacts;
    expect(done.total).toBe(1);
    expect(done.listStatus).toBe("succeeded");

    store.dispatch(fetchContacts.pending("r2"));
    const err = Object.assign(new Error("Aborted"), { name: "AbortError" });
    store.dispatch(fetchContacts.rejected(err, "r2", undefined, undefined, { aborted: true, condition: false }));
    expect(store.getState().contacts.listStatus).toBe("loading");
    expect(store.getState().contacts.listError).toBeNull();
  });

  describe("updateContact", () => {
    afterEach(() => vi.unstubAllGlobals());
    const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });

    it("rejects with server error and leaves items untouched", async () => {
      const fetchMock = vi.fn().mockResolvedValue(json({ error: "Bad email" }, false));
      vi.stubGlobal("fetch", fetchMock);
      const store = makeStore();
      await expect(store.dispatch(updateContact({ id: "1", changes: {} })).unwrap()).rejects.toBe("Bad email");
      expect(store.getState().contacts.items).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refetches the list after success", async () => {
      const page = { items: [{ id: "1" }], total: 1, page: 1, pageSize: 25, facets };
      const fetchMock = vi.fn().mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json(page));
      vi.stubGlobal("fetch", fetchMock);
      const store = makeStore();
      await store.dispatch(updateContact({ id: "1", changes: {} })).unwrap();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/contacts/1");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/contacts?");
      expect(store.getState().contacts.total).toBe(1);
    });
  });

  const page = (ids: string[]) =>
    ({ items: ids.map((id) => ({ id })), total: 9, page: 1, pageSize: 25, facets }) as unknown as ContactsPageResponse;

  it("loadMoreContacts.fulfilled appends, dedupes, bumps loadedPages, keeps query", () => {
    const store = makeStore();
    store.dispatch(fetchContacts.fulfilled(page(["1", "2"]), "r1"));
    const q = store.getState().contacts.query;
    store.dispatch(loadMoreContacts.fulfilled(page(["2", "3"]), "r2"));
    const c = store.getState().contacts;
    expect(c.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(c.loadedPages).toBe(2);
    expect(c.query).toBe(q);
  });

  it("fetchContacts({ keepLoaded }) with 3 loaded pages requests page=1&pageSize=75", async () => {
    const store = makeStore();
    store.dispatch(loadMoreContacts.fulfilled(page(["1"]), "a"));
    store.dispatch(loadMoreContacts.fulfilled(page(["2"]), "b"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page(["1", "2"]) });
    vi.stubGlobal("fetch", fetchMock);
    await store.dispatch(fetchContacts({ keepLoaded: true }));
    const url = new URL(fetchMock.mock.calls[0][0], "http://x");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("75");
    expect(store.getState().contacts.loadedPages).toBe(3);
  });
});
