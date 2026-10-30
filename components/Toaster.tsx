"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Single toast host for the app. Bottom-centre on every breakpoint; the mobile
 * offset clears the fixed dock (`app/page.tsx`), which sits ~80px up.
 */
export default function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={{ bottom: 24 }}
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 88px)" }}
      closeButton
      visibleToasts={2}
      toastOptions={{
        classNames: {
          toast:
            "font-body rounded-xl border-stone-900/[0.06] bg-white text-ink shadow-lift",
          title: "font-medium",
          description: "text-stone-500",
          actionButton: "!bg-accent-700 !text-white !font-medium",
          closeButton: "!bg-white !border-stone-200 !text-stone-500",
        },
      }}
    />
  );
}
