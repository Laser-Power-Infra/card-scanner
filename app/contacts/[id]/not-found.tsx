import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ContactNotFound() {
  return (
    <main id="main" className="bg-grain flex min-h-[calc(100dvh-64px)] items-center justify-center px-4">
      <div className="text-center">
        <h1 className="font-display text-2xl font-medium text-ink">Contact not found</h1>
        <p className="mt-2 text-sm text-stone-500">It may have been deleted, or the link is wrong.</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent-700 px-4 py-2.5 text-sm font-medium text-white shadow-soft transition hover:bg-accent-800 active:scale-[.98]"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          All contacts
        </Link>
      </div>
    </main>
  );
}
