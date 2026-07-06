import type { CardData } from "@/types/card";

type ContactTableProps = {
  contacts: CardData[];
};

export default function ContactTable({
  contacts,
}: ContactTableProps) {
  if (contacts.length === 0) {
    return (
      <div className="rounded-xl border border-ivory/15 p-6 text-center text-ivory/60">
        No contacts found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ivory/15">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ivory/15 bg-white/5">
            <th className="px-4 py-3 text-left text-sm font-medium">
              Name
            </th>

            <th className="px-4 py-3 text-left text-sm font-medium">
              Company
            </th>

            <th className="px-4 py-3 text-left text-sm font-medium">
              Job Title
            </th>

            <th className="px-4 py-3 text-left text-sm font-medium">
              Email
            </th>

            <th className="px-4 py-3 text-left text-sm font-medium">
              Phone
            </th>

            <th className="px-4 py-3 text-left text-sm font-medium">
              Website
            </th>
          </tr>
        </thead>

        <tbody>
          {contacts.map((contact, index) => (
            <tr
              key={index}
              className="border-b border-ivory/10 hover:bg-white/5"
            >
              <td className="px-4 py-3">
                {contact.fullName || "-"}
              </td>

              <td className="px-4 py-3">
                {contact.company || "-"}
              </td>

              <td className="px-4 py-3">
                {contact.jobTitle || "-"}
              </td>

              <td className="px-4 py-3">
                {contact.emails?.[0] || "-"}
              </td>

              <td className="px-4 py-3">
                {contact.phones?.[0] || "-"}
              </td>

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
  );
}