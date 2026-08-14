import { Fragment } from "react";
import { ExternalLink } from "lucide-react";

const URL_RE = /https?:\/\/[^\s)]+/g;

const LINK_CLASS =
  "inline-flex items-center gap-1 text-sky-600 hover:text-sky-800";

function normalizeUrl(url: string): string {
  return url.replace(/[.,;:]$/, "");
}

export function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  const urls = text.match(URL_RE) ?? [];

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < urls.length && (
            <a
              href={normalizeUrl(urls[i])}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS}
            >
              {normalizeUrl(urls[i])}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}

const BULLET_RE = /^\s*(?:[•\-\*\u2022]|\d+[\.\)])\s*/;

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line.trim());
}

export function BulletBlock({ text }: { text: string }) {
  const lines = (text ?? "").split("\n").map((l) => l.trim());
  const hasBullets = lines.some(isBulletLine);

  if (!hasBullets) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }

  return (
    <ul className="list-disc space-y-1 pl-5">
      {lines
        .filter((l) => l.length > 0)
        .map((line, i) => (
          <li key={i} className="text-slate-800">
            <Linkify text={line.replace(BULLET_RE, "")} />
          </li>
        ))}
    </ul>
  );
}

const LABEL_URL_RE = /^([^:]+):\s*(https?:\/\/\S+)/i;

function parseLabelledLine(line: string): { label: string; url: string }[] {
  return line
    .split("|")
    .map((seg) => {
      const m = seg.trim().match(LABEL_URL_RE);
      if (!m) return null;
      return { label: m[1].trim(), url: normalizeUrl(m[2].trim()) };
    })
    .filter((x): x is { label: string; url: string } => x !== null);
}

export function LabelledLinks({ text }: { text: string }) {
  const items = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap(parseLabelledLine);

  if (items.length === 0) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }

  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="text-slate-800">
          <span className="mr-1 font-medium">{item.label}:</span>
          <Linkify text={item.url} />
        </li>
      ))}
    </ul>
  );
}

export function SourceLinks({ text }: { text: string }) {
  const urls = (text ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }

  return (
    <ul className="space-y-1">
      {urls.map((url, i) => (
        <li key={i} className="text-slate-800">
          <Linkify text={normalizeUrl(url)} />
        </li>
      ))}
    </ul>
  );
}

export function extractWhatsApp(
  text: string | null | undefined
): { url: string; remaining: string } | null {
  if (!text) return null;

  const m = text.match(/whatsapp\s*:\s*(https?:\/\/\S+)/i);
  if (!m) return null;

  const url = normalizeUrl(m[1].trim());
  const remaining = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^whatsapp\s*:/i.test(l))
    .join("\n");

  return { url, remaining };
}
