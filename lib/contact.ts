// Small, framework-free helpers shared by the directory and the profile page.

type VCardInput = {
  fullName: string | null;
  company: string | null;
  jobTitle: string | null;
  mobileNumbers?: string[];
  telephoneNumbers?: string[];
  emails?: string[];
  website: string | null;
  address: string | null;
};

export function initials(name: string | null): string {
  return (name ?? "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function toVCard(c: VCardInput): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    c.fullName ? `FN:${c.fullName}` : "",
    c.company ? `ORG:${c.company}` : "",
    c.jobTitle ? `TITLE:${c.jobTitle}` : "",
    ...(c.mobileNumbers ?? []).map((p) => `TEL;TYPE=CELL:${p}`),
    ...(c.telephoneNumbers ?? []).map((p) => `TEL;TYPE=WORK:${p}`),
    ...(c.emails ?? []).map((e) => `EMAIL:${e}`),
    c.website ? `URL:${c.website}` : "",
    c.address ? `ADR;TYPE=WORK:;;${c.address.replace(/\n/g, " ")}` : "",
    "END:VCARD",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Browser-only: triggers a .vcf download. */
export function downloadVCard(c: VCardInput) {
  const url = URL.createObjectURL(new Blob([toVCard(c)], { type: "text/vcard" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${c.fullName ?? c.company ?? "contact"}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Normalises a bare domain to a clickable URL. */
export const toHref = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

/** Strips protocol and trailing slash for display. */
export const bareUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** wa.me link from a phone number, or null if it has too few digits. */
export function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}
