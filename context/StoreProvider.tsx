"use client";

import { ReactNode, useState } from "react";
import { Provider } from "react-redux";

import { makeStore } from "@/lib/store";

export default function StoreProvider({ children }: { children: ReactNode }) {
  // One store per client instance, never a module singleton.
  const [store] = useState(makeStore);
  return <Provider store={store}>{children}</Provider>;
}
