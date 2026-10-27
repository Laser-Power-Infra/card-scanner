import { describe, expect, it } from "vitest";
import { makeStore } from "@/lib/store";
import {
  buildContactsQuery,
  clearFilters,
  fetchContacts,
  setFacetFilter,
  setPage,
  setPageSize,
  setSearch,
  setTextFilter,
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
});
