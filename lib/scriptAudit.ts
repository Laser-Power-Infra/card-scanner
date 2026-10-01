import * as fs from "fs";
import * as path from "path";
import { stringify } from "hjson";

export interface AuditEntry {
  timestamp: string;
  dryRun: boolean;
  contactId: string;
  field: string;
  before: unknown;
  after: unknown;
}

export class ScriptAudit {
  private entries: AuditEntry[] = [];
  private scriptName: string;
  private dryRun: boolean;

  constructor(scriptName: string, dryRun: boolean) {
    this.scriptName = scriptName;
    this.dryRun = dryRun;
  }

  record(contactId: string, field: string, before: unknown, after: unknown): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      dryRun: this.dryRun,
      contactId,
      field,
      before,
      after,
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

  write(): void {
    const dir = path.join(process.cwd(), "scripts", "runs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.scriptName}.hjson`);
    const output = stringify({ entries: this.entries }, { keepWsc: true });
    fs.writeFileSync(file, output);
    console.log(`Audit log written to ${file}`);
  }
}