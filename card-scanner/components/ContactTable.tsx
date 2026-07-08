import { useMemo, useState } from "react";
import type { CardData } from "@/types/card";

type ContactTableProps = {
  contacts: CardData[];
  pageSize?: number;
};

export default function ContactTable({
  contacts,
  pageSize = 10,
}: ContactTableProps) {
  const [page, setPage] = useState(1);

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

  const total = deduped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // clamp page
  if (page > totalPages) setPage(totalPages);

  const pageStart = (page - 1) * pageSize;
  const pageItems = deduped.slice(pageStart, pageStart + pageSize);

  if (deduped.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-6 text-center text-slate-500">
        No contacts found
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Company</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Job Title</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Email</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Mobile</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Telephone</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Website</th>
            </tr>
          </thead>

          <tbody>
            {pageItems.map((contact, index) => (
              <tr
                key={`${(contact.emails?.[0] || contact.mobileNumbers?.[0] || contact.fullName || "")}-${index}`}
                className="border-b border-slate-200 hover:bg-sky-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">{contact.fullName || "-"}</td>
                <td className="px-4 py-3">{contact.company || "-"}</td>
                <td className="px-4 py-3">{contact.jobTitle || "-"}</td>
                <td className="px-4 py-3">{contact.emails?.[0] || "-"}</td>
                <td className="px-4 py-3">{contact.mobileNumbers?.[0] || "-"}</td>
                <td className="px-4 py-3">{contact.telephoneNumbers?.[0] || "-"}</td>
                <td className="px-4 py-3">
                  {contact.website ? (
                    <a
                      href={contact.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Visit
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-slate-600">Showing {pageStart + 1}-{Math.min(pageStart + pageSize, total)} of {total}</div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
          >
            Prev
          </button>

          <div className="hidden sm:flex items-center gap-1">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i + 1)}
                className={`px-3 py-1 rounded-md border ${i + 1 === page ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-700 border-slate-200"}`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}