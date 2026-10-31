/**
 * Per-contact cleanup pipeline.
 *
 * One contact id in, one row out. Every stage reads the row, computes a patch
 * in memory, and the pipeline writes once (unless --dry-run). There is no
 * "load the whole table" path here.
 *
 * Stage order matters: phones and emails feed the dedupe key, name/company feed
 * it too, and location feeds state/country.
 */

import { prisma } from "./prisma";
import type { Prisma } from "./generated/prisma/client";
import { contactDerivedFields } from "./contact";
import { normalizeNumberSets, parsePhone } from "./cleaning/phone";
import { planContactFields, emailDomain } from "./cleaning/contactFields";
import {
  applyPersonLlmResult,
  PERSON_SYSTEM_PROMPT,
  planPersonName,
  type PersonFields,
  type PersonLlmResult,
  type PersonLlmRow,
} from "./cleaning/personName";
import { repairCompanyLocation } from "./cleaning/locationFix";
import { chatRows } from "./llm";

export type PipelineStage = "phones" | "fields" | "person" | "location" | "dedupe";

export interface PipelineReview {
  field: string;
  reason: string;
  proposed?: unknown;
}

export interface ProcessContactOptions {
  /** Run only one cleaning stage. Omit to run all four + dedupe. */
  only?: PipelineStage;
  /** Preview the patch without writing. Also skips the LLM call. */
  dryRun?: boolean;
  /** Set false to keep name/job/company deterministic only. */
  llm?: boolean;
}

export interface ProcessedContact {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  mobileNumbers: string[];
  telephoneNumbers: string[];
  emails: string[];
  website: string | null;
  address: string | null;
  companyLocation: string | null;
  linkedin: string | null;
  rawNotes: string | null;
  originalImageUrl: string | null;
  originalBackImageUrl: string | null;
}

export interface ProcessContactResult {
  contactId: string;
  status: "updated" | "unchanged" | "missing";
  changed: string[];
  reviews: PipelineReview[];
  llmUsed: boolean;
  dedupeLosers: string[];
  contact: ProcessedContact | null;
}

type ContactRecord = ProcessedContact & {
  state: string | null;
  country: string | null;
  dedupeKey: string | null;
  status: string;
  createdAt: Date;
  enrichment: { company_details: string | null; location: string | null } | null;
};

type Working = ContactRecord;

const DIFF_FIELDS = [
  "fullName",
  "jobTitle",
  "company",
  "mobileNumbers",
  "telephoneNumbers",
  "emails",
  "website",
  "address",
  "companyLocation",
  "linkedin",
  "state",
  "country",
  "dedupeKey",
  "status",
] as const;

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  return (a ?? null) === (b ?? null);
}

function buildPatch(before: ContactRecord, after: Working): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of DIFF_FIELDS) {
    if (!sameValue(before[field], after[field])) {
      patch[field] = after[field];
    }
  }
  return patch;
}

/**
 * Domain frequency is used only to arbitrate OCR variants. Query only the
 * domains this row already contains rather than scanning every contact.
 */
async function loadDomainFrequency(emails: string[]): Promise<Map<string, number>> {
  const domains = [...new Set(emails.map(emailDomain).filter((d): d is string => !!d))];
  if (!domains.length) return new Map();

  try {
    const rows = await prisma.$queryRaw<{ domain: string; count: number }[]>`
      SELECT lower(split_part(email, '@', 2)) AS domain, count(*)::int AS count
      FROM "Contact" c, unnest(c."emails") AS email
      WHERE lower(split_part(email, '@', 2)) = ANY(${domains}::text[])
      GROUP BY 1
    `;
    const frequency = new Map<string, number>();
    for (const row of rows) frequency.set(row.domain, Number(row.count));
    return frequency;
  } catch (err) {
    console.warn("[ContactPipeline] domain frequency query failed:", err);
    return new Map();
  }
}

function applyPhones(working: Working, reviews: PipelineReview[]): void {
  const mobilesIn = [...working.mobileNumbers];
  const telsIn = [...working.telephoneNumbers];

  const extByE164 = new Map<string, string>();
  for (const raw of [...mobilesIn, ...telsIn]) {
    const parsed = parsePhone(raw);
    if (parsed.e164 && parsed.ext) extByE164.set(parsed.e164, parsed.ext);
  }

  const normalized = normalizeNumberSets({ mobiles: mobilesIn, tels: telsIn });
  const telsFinal = normalized.tels.map((tel) => {
    const ext = extByE164.get(tel);
    return ext ? `${tel} x${ext}` : tel;
  });

  for (const item of normalized.review) {
    reviews.push({ field: "phoneNumbers", reason: item.reason, proposed: item.raw });
  }

  working.mobileNumbers = normalized.mobiles;
  working.telephoneNumbers = telsFinal;
}

function applyFields(
  working: Working,
  domainFrequency: Map<string, number>,
  reviews: PipelineReview[],
): void {
  const plan = planContactFields(
    {
      fullName: working.fullName,
      jobTitle: working.jobTitle,
      company: working.company,
      address: working.address,
      emails: working.emails,
      website: working.website,
      linkedin: working.linkedin,
    },
    domainFrequency,
  );

  if (plan.data.fullName !== undefined) working.fullName = plan.data.fullName;
  if (plan.data.jobTitle !== undefined) working.jobTitle = plan.data.jobTitle;
  if (plan.data.company !== undefined) working.company = plan.data.company;
  if (plan.data.address !== undefined) working.address = plan.data.address;
  if (plan.data.emails !== undefined) working.emails = plan.data.emails;
  if (plan.data.website !== undefined) working.website = plan.data.website;
  if (plan.data.linkedin !== undefined) working.linkedin = plan.data.linkedin;

  reviews.push(...plan.reviews);
}

async function applyPerson(
  working: Working,
  options: ProcessContactOptions,
  reviews: PipelineReview[],
): Promise<boolean> {
  const plan = planPersonName({
    id: working.id,
    fullName: working.fullName,
    jobTitle: working.jobTitle,
    company: working.company,
    website: working.website,
    emails: working.emails,
    enrichment: working.enrichment,
  });

  working.fullName = plan.fields.fullName;
  working.jobTitle = plan.fields.jobTitle;
  working.company = plan.fields.company;
  reviews.push(...plan.reviews);

  if (!plan.llmRow || options.llm === false || options.dryRun) return false;

  const rows = await chatRows<PersonLlmResult>({
    system: PERSON_SYSTEM_PROMPT,
    user: [plan.llmRow],
  });
  const result = rows.find((row) => row.id === plan.llmRow!.id) ?? rows[0];
  if (!result) return false;

  const current: PersonFields = {
    fullName: working.fullName,
    jobTitle: working.jobTitle,
    company: working.company,
  };
  const applied = applyPersonLlmResult(plan.llmRow as PersonLlmRow, current, result);
  working.fullName = applied.fields.fullName;
  working.jobTitle = applied.fields.jobTitle;
  working.company = applied.fields.company;
  if (applied.review) reviews.push(applied.review);
  return true;
}

function applyLocation(working: Working, reviews: PipelineReview[]): void {
  const current = working.companyLocation ?? null;
  const address = working.address ?? null;
  const repair = repairCompanyLocation(current ?? "", address);

  let value = repair.value;

  if (value === null && !address && working.enrichment?.location) {
    const alt = repairCompanyLocation(working.enrichment.location, null);
    if (alt.value) {
      value = alt.value;
    }
  }

  if (value === null) {
    if (repair.review) {
      reviews.push({
        field: "companyLocation",
        reason: repair.review,
        proposed: current,
      });
      return;
    }
    if (current !== null) working.companyLocation = null;
    return;
  }

  if (value !== current) {
    working.companyLocation = value;
  }
}

interface DedupeResult {
  winnerId: string | null;
  losers: string[];
  currentStatus: "active" | "inactive";
}

async function reconcileDedupe(
  contactId: string,
  key: string | null,
  dryRun: boolean,
): Promise<DedupeResult> {
  if (!key) {
    return { winnerId: contactId, losers: [], currentStatus: "active" };
  }

  const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];

  if (dryRun) {
    const rows = await prisma.contact.findMany({
      where: { dedupeKey: key },
      select: { id: true, status: true },
      orderBy: order,
    });
    const winnerId = rows[0]?.id ?? contactId;
    return {
      winnerId,
      losers: rows.filter((row) => row.id !== winnerId).map((row) => row.id),
      currentStatus: winnerId === contactId ? "active" : "inactive",
    };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

    const rows = await tx.contact.findMany({
      where: { dedupeKey: key },
      select: { id: true, status: true },
      orderBy: order,
    });
    if (!rows.length) {
      return { winnerId: contactId, losers: [], currentStatus: "active" as const };
    }

    const winnerId = rows[0].id;
    const losers = rows.filter((row) => row.id !== winnerId).map((row) => row.id);

    if (losers.length) {
      await tx.contact.updateMany({
        where: { id: { in: losers }, status: { not: "inactive" } },
        data: { status: "inactive" },
      });
    }
    if (rows[0].status !== "active") {
      await tx.contact.update({ where: { id: winnerId }, data: { status: "active" } });
    }

    return {
      winnerId,
      losers,
      currentStatus: winnerId === contactId ? ("active" as const) : ("inactive" as const),
    };
  });
}

/** Process exactly one contact. Missing ids are reported, never fatal. */
export async function processContactById(
  contactId: string,
  options: ProcessContactOptions = {},
): Promise<ProcessContactResult> {
  const contact = (await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      company: true,
      mobileNumbers: true,
      telephoneNumbers: true,
      emails: true,
      website: true,
      address: true,
      companyLocation: true,
      linkedin: true,
      rawNotes: true,
      originalImageUrl: true,
      originalBackImageUrl: true,
      state: true,
      country: true,
      dedupeKey: true,
      status: true,
      createdAt: true,
      enrichment: { select: { company_details: true, location: true } },
    },
  })) as ContactRecord | null;

  if (!contact) {
    console.warn(`[ContactPipeline] contact not found: ${contactId}`);
    return {
      contactId,
      status: "missing",
      changed: [],
      reviews: [],
      llmUsed: false,
      dedupeLosers: [],
      contact: null,
    };
  }

  const working: Working = {
    ...contact,
    mobileNumbers: [...contact.mobileNumbers],
    telephoneNumbers: [...contact.telephoneNumbers],
    emails: [...contact.emails],
  };
  const reviews: PipelineReview[] = [];
  const shouldRun = (stage: PipelineStage) => !options.only || options.only === stage;

  if (shouldRun("phones")) applyPhones(working, reviews);
  if (shouldRun("fields")) {
    const frequency = await loadDomainFrequency(working.emails);
    applyFields(working, frequency, reviews);
  }

  let llmUsed = false;
  if (shouldRun("person")) {
    llmUsed = await applyPerson(working, options, reviews);
  }
  if (shouldRun("location")) applyLocation(working, reviews);

  const derived = contactDerivedFields({
    emails: working.emails,
    mobileNumbers: working.mobileNumbers,
    telephoneNumbers: working.telephoneNumbers,
    fullName: working.fullName,
    company: working.company,
    address: working.address,
    companyLocation: working.companyLocation,
  });
  working.state = derived.state;
  working.country = derived.country;
  working.dedupeKey = derived.dedupeKey;
  working.status = "active";

  const patch = buildPatch(contact, working);
  if (!options.dryRun && Object.keys(patch).length > 0) {
    await prisma.contact.update({
      where: { id: contactId },
      data: patch as Prisma.ContactUpdateInput,
    });
  }

  const dedupe = await reconcileDedupe(contactId, working.dedupeKey, !!options.dryRun);
  working.status = dedupe.currentStatus;

  const changed = [...Object.keys(patch)];
  if (dedupe.currentStatus !== (patch.status ?? contact.status)) {
    changed.push("status");
  }

  const result: ProcessContactResult = {
    contactId,
    status: changed.length ? "updated" : "unchanged",
    changed,
    reviews,
    llmUsed,
    dedupeLosers: dedupe.losers,
    contact: working,
  };

  console.log(
    JSON.stringify({
      tag: "[ContactPipeline]",
      contactId,
      status: result.status,
      changed,
      reviewCount: reviews.length,
      reviews: reviews.slice(0, 20),
      llmUsed,
      dedupeLosers: dedupe.losers,
      dryRun: !!options.dryRun,
    }),
  );

  return result;
}

/** Accept both `--id=abc` and `--id abc`. */
export function parseContactIdArg(argv: string[] = process.argv): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--id") return argv[i + 1] ?? null;
    if (arg.startsWith("--id=")) return arg.slice("--id=".length) || null;
  }
  return null;
}

export function printContactIdUsage(script: string): void {
  console.error(
    `Usage: pnpm tsx scripts/${script}.ts --id=<contactId> [--dry-run]`,
  );
  console.error("This script processes exactly one contact; bulk runs were removed.");
}
