"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Globe,
  Link2,
  Linkedin,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
} from "lucide-react";

import { initials } from "@/lib/contact";
import type { CardData } from "@/types/card";

interface ContactCardProps {
  data: CardData;
  /** Profile page URL; the "View profile" link is hidden when absent. */
  profileHref?: string;
  /** Content of the ⋯ menu; the button is hidden when absent. */
  actions?: React.ReactNode;
}

type Item = { key: string; icon: React.ReactNode; text: string; href?: string; external?: boolean };

const STATUS_DOT: Record<string, string> = {
  DONE: "bg-accent-500",
  RUNNING: "bg-accent-400 animate-pulse",
  PARTIAL: "bg-amber-500",
  FAILED: "bg-red-500",
  PENDING: "bg-stone-300",
};

const icon = (Icon: typeof Phone) => <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />;
const bare = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const href = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

function Line({ item }: { item: Item }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 text-sm text-stone-700">
      <span className="shrink-0 text-stone-400">{item.icon}</span>
      {item.href ? (
        <a
          href={item.href}
          {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="truncate transition-colors hover:text-accent-700 hover:underline hover:underline-offset-2"
          title={item.text}
        >
          {item.text}
        </a>
      ) : (
        <span className="truncate" title={item.text}>
          {item.text}
        </span>
      )}
    </li>
  );
}

export default function ContactCard({ data, profileHref, actions }: ContactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const phones = [...(data.mobileNumbers ?? []), ...(data.telephoneNumbers ?? [])];
  const emails = data.emails ?? [];
  const location = data.companyLocation ?? data.address;

  const phoneItem = (p: string, i: number): Item => ({ key: `p${i}`, icon: icon(Phone), text: p, href: `tel:${p}` });
  const emailItem = (e: string, i: number): Item => ({ key: `e${i}`, icon: icon(Mail), text: e, href: `mailto:${e}` });

  const primary: Item[] = [
    ...phones.slice(0, 1).map(phoneItem),
    ...emails.slice(0, 1).map(emailItem),
    ...(location ? [{ key: "loc", icon: icon(MapPin), text: location }] : []),
  ];

  const more: Item[] = [
    ...phones.slice(1).map((p, i) => phoneItem(p, i + 1)),
    ...emails.slice(1).map((e, i) => emailItem(e, i + 1)),
    ...(data.website ? [{ key: "web", icon: icon(Globe), text: bare(data.website), href: href(data.website), external: true }] : []),
    ...(data.linkedin ? [{ key: "in", icon: icon(Linkedin), text: bare(data.linkedin), href: href(data.linkedin), external: true }] : []),
    ...(data.otherSocials ?? []).map((s, i) => ({ key: `s${i}`, icon: icon(Link2), text: `${s.label}: ${bare(s.url)}`, href: href(s.url), external: true })),
    // Location line used companyLocation, so the street address is still unseen.
    ...(data.companyLocation && data.address ? [{ key: "addr", icon: icon(MapPin), text: data.address }] : []),
  ];

  const visible = expanded ? [...primary, ...more] : primary;
  const status = data.enrichment?.status ?? null;
  const name = data.fullName ?? data.company;
  const subtitle = data.fullName ? data.company : null;

  return (
    <article className="flex h-full w-full flex-col rounded-2xl bg-white shadow-soft ring-1 ring-stone-900/[0.04] transition-shadow duration-300 ease-spring hover:shadow-lift">
      <div className="p-5 pb-4">
        <header className="flex items-start gap-3">
          <div
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-50 font-display text-base font-medium text-accent-800"
          >
            {initials(name) || "?"}
          </div>

          <div className="min-w-0 flex-1">
            <h2
              className="line-clamp-1 font-display text-lg font-medium leading-snug tracking-tight text-ink"
              title={data.fullName ?? undefined}
            >
              {data.fullName ?? "Name not found"}
            </h2>
            {data.jobTitle && (
              <p className="truncate text-sm text-stone-500" title={data.jobTitle}>
                {data.jobTitle}
              </p>
            )}
            {subtitle && (
              <p className="truncate text-sm font-medium text-stone-700" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>

          {status && (
            <span
              className={`mt-2 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.PENDING}`}
              title={`Enrichment: ${status.toLowerCase()}`}
            >
              <span className="sr-only">Enrichment {status.toLowerCase()}</span>
            </span>
          )}
        </header>

        {visible.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {visible.map((item) => (
              <Line key={item.key} item={item} />
            ))}
          </ul>
        ) : more.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">
            No readable details were found on this card. Try a clearer, well-lit photo.
          </p>
        ) : null}

        {more.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 rounded-md text-xs font-medium text-accent-700 transition hover:text-accent-900 hover:underline hover:underline-offset-2"
          >
            {expanded ? "Show less" : `+ ${more.length} more`}
          </button>
        )}
      </div>

      {(profileHref || actions) && (
        <footer className="mt-auto flex items-center justify-between gap-2 border-t border-stone-100 px-5 py-2.5">
          {profileHref ? (
            <Link
              href={profileHref}
              className="group inline-flex items-center gap-1 rounded-md text-sm font-medium text-ink transition hover:text-accent-700"
            >
              View profile
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </Link>
          ) : (
            <span />
          )}

          {actions && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More actions"
                aria-expanded={menuOpen}
                className="rounded-lg p-1.5 text-stone-500 transition hover:bg-stone-900/5 hover:text-ink"
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} />
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-64 animate-rise rounded-xl bg-white p-3 shadow-pop ring-1 ring-stone-900/[0.06]">
                    <p className="mb-2 text-xs font-medium text-stone-400">Collect profile</p>
                    {actions}
                  </div>
                </>
              )}
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
