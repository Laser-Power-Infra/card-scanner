import * as fs from "fs";
import * as path from "path";
import { stringify } from "hjson";

/**
 * Shared audit/review writer for the DB cleanup scripts.
 *
 * Every script writes two timestamped artifacts under `scripts/runs/` (which is
 * gitignored):
 *   - `<script>-<ts>.hjson`       only the fields that actually changed, plus a
 *                                 trailing `__run__` summary line.
 *   - `<script>-<ts>.review.json` rows the script refused to apply, with a
 *                                 reason and (when known) a proposed value.
 *
 * `--dry-run` runs write both artifacts but never touch the database; the
 * `dryRun` flag is stamped on every entry so a log cannot be mistaken for an
 * applied run.
 */

export interface AuditEntry {
  timestamp: string;
  dryRun: boolean;
  contactId: string;
  field: string;
  before: unknown;
  after: unknown;
  meta?: Record<string, unknown>;
}

export interface ReviewProposal {
  reason: string;
  proposed?: unknown;
  source?: string;
  confidence?: string;
}

export interface ReviewEntry extends ReviewProposal {
  timestamp: string;
  dryRun: boolean;
  contactId: string;
  field: string;
}

/** Filename-safe timestamp: `2026-10-05T13-42-07-123Z`. */
export function runStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function runsDir(): string {
  return path.join(process.cwd(), "scripts", "runs");
}

export class ScriptAudit {
  private readonly entries: AuditEntry[] = [];
  private readonly reviewEntries: ReviewEntry[] = [];
  private readonly scriptName: string;
  readonly dryRun: boolean;
  readonly stamp: string;

  constructor(scriptName: string, dryRun: boolean) {
    this.scriptName = scriptName;
    this.dryRun = dryRun;
    this.stamp = runStamp();
  }

  get changes(): number {
    return this.entries.length;
  }

  get reviews(): number {
    return this.reviewEntries.length;
  }

  record(
    contactId: string,
    field: string,
    before: unknown,
    after: unknown,
    meta?: Record<string, unknown>,
  ): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      dryRun: this.dryRun,
      contactId,
      field,
      before,
      after,
      ...(meta ? { meta } : {}),
    });
  }

  /** Record a row/field the script deliberately did not apply. */
  review(contactId: string, field: string, proposal: ReviewProposal): void {
    this.reviewEntries.push({
      timestamp: new Date().toISOString(),
      dryRun: this.dryRun,
      contactId,
      field,
      ...proposal,
    });
  }

  logRun(summary: string): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      dryRun: this.dryRun,
      contactId: "",
      field: "__run__",
      before: null,
      after: summary,
    });
  }

  /** Write both artifacts and return the audit-log path. */
  write(): string {
    const dir = runsDir();
    fs.mkdirSync(dir, { recursive: true });

    const auditFile = path.join(dir, `${this.scriptName}-${this.stamp}.hjson`);
    fs.writeFileSync(auditFile, stringify({ entries: this.entries }, { keepWsc: true }));
    console.log(`Audit log written to ${auditFile}`);

    if (this.reviewEntries.length > 0) {
      const reviewFile = path.join(dir, `${this.scriptName}-${this.stamp}.review.json`);
      fs.writeFileSync(reviewFile, JSON.stringify(this.reviewEntries, null, 2));
      console.log(`Review file written to ${reviewFile} (${this.reviewEntries.length} rows)`);
    }

    return auditFile;
  }
}

/** True when the process was started with `--dry-run`. */
export function isDryRun(argv: string[] = process.argv): boolean {
  return argv.includes("--dry-run");
}
