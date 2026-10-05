import * as fs from "fs";
import * as path from "path";
import { runStamp, runsDir } from "./scriptAudit";

/**
 * Before-image snapshots for the destructive cleanup scripts.
 *
 * A writer snapshots every full row it is about to change BEFORE its first
 * write, to `scripts/runs/<script>-<ts>.snapshot.json`. A dry run never writes a
 * snapshot. `restore-snapshot.ts` reads these files to put rows back.
 */

export interface Snapshot {
  script: string;
  key: string;
  createdAt: string;
  rows: Record<string, unknown>[];
}

export function writeSnapshot(
  scriptName: string,
  rows: Record<string, unknown>[],
  key = "id",
): string {
  const dir = runsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${scriptName}-${runStamp()}.snapshot.json`);
  const snapshot: Snapshot = {
    script: scriptName,
    key,
    createdAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}

export function readSnapshot(file: string): Snapshot {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot | Record<string, unknown>[];
  if (Array.isArray(parsed)) {
    return { script: "unknown", key: "id", createdAt: "", rows: parsed };
  }
  return parsed;
}
