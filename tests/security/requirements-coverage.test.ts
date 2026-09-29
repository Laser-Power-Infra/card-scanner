import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * GATE-02: a requirement is only covered if a named, existing test says so.
 *
 * The scope is derived, never hardcoded: the ids come from REQUIREMENTS.md and
 * the phase's own requirements line from ROADMAP.md. A requirement added
 * tomorrow therefore appears here as unclaimed without anyone editing this
 * file, which is the "cannot silently ship untested" property.
 *
 * The claim table is tests/REQUIREMENT-MAP.md. It is data, and this test is the
 * only thing that reads it, so the two must be changed together.
 */

const REPO_ROOT = process.cwd();
const PHASE_NUMBER = 1;

/**
 * The planning documents this suite derives its scope from.
 *
 * `.planning/` is gitignored as a whole, so these two are force-added
 * (`git add -f`) rather than un-ignored in `.gitignore`. That is deliberate on
 * both sides: the rest of the directory stays a local scratch space, and these
 * two are tracked because a test reads them, so their drift has to show up in
 * `git status` instead of existing only on one machine.
 */
const REQUIREMENTS = ".planning/REQUIREMENTS.md";
const ROADMAP = ".planning/ROADMAP.md";

const readRepoFile = (relative: string) =>
  readFileSync(resolve(REPO_ROOT, relative), "utf8");

/**
 * Read a tracked input, failing with the name of what is missing.
 *
 * These three reads run at module scope, before any `describe`, so a plain
 * readFileSync turns an absent input into a bare ENOENT that names a path and
 * no remedy — the whole file dies and the developer cannot even see which of
 * the eight cases below were meant to run. Naming the input turns that into an
 * actionable setup error.
 */
function readRequired(relative: string): string {
  const abs = resolve(REPO_ROOT, relative);

  if (!existsSync(abs)) {
    throw new Error(
      `Missing tracked input ${relative}. It is read at module scope, so the ` +
        `whole suite fails to import until it is present. Restore it with ` +
        `\`git checkout -- ${relative}\` (both are force-added past the ` +
        `.gitignore rule that ignores .planning/ as a whole).`
    );
  }

  return readFileSync(abs, "utf8");
}

/**
 * The v1 checkbox rows: `- [ ] **SEC-01**: ...` and `- [x] **GATE-01**: ...`.
 *
 * Requiring the checkbox is deliberate. The v2 ids (HYG-*, STR-*) are written
 * without one because they are deferred to a later milestone, and they must not
 * be dragged into a phase-1 completeness claim.
 */
const REQUIREMENT_ID = /^-\s*\[[ xX]\]\s*\*\*([A-Z]+-\d+)\*\*/;

/** The four families Phases 2-5 own. A SEC or GATE id is never tolerated here. */
const DEFERRED_FAMILY = /^(?:PWD|ABT|UPL|LOG)-\d+$/;

type Claim = {
  id: string;
  testCell: string;
  /** Backticked `.ts` path, absent for a row claimed against a command. */
  path: string | null;
  /** Quoted `it(...)` description, absent for a row claimed against a command. */
  description: string | null;
};

function parseRequirementIds(markdown: string): string[] {
  const ids: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = REQUIREMENT_ID.exec(line);

    if (match) ids.push(match[1]);
  }

  return ids;
}

/**
 * The requirements a phase owns, read off its own `**Requirements**:` line.
 * The roadmap is the phase contract: if the scope is renegotiated there, this
 * follows without a code change.
 */
function parsePhaseScope(markdown: string, phaseNumber: number): string[] {
  const start = markdown.indexOf(`### Phase ${phaseNumber}:`);

  if (start === -1) return [];

  const rest = markdown.slice(start + 1);
  const nextHeading = rest.search(/\n###\s/);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const line = /^\*\*Requirements\*\*:\s*(.+)$/m.exec(section);

  if (!line) return [];

  return line[1]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

const TEST_PATH = /`([^`]+\.ts)`/;
const TEST_NAME = /"([^"]+)"/;

function parseClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;

    // A row is "| Requirement | Test | Assertion |", so cells[0] and
    // cells[cells.length - 1] are the empty strings either side of the border.
    const cells = line.split("|").map((cell) => cell.trim());
    const id = (cells[1] ?? "").replace(/\*\*/g, "");

    // Drops the header row and the ---|--- separator, which are not ids.
    if (!/^[A-Z]+-\d+$/.test(id)) continue;

    const testCell = cells[2] ?? "";

    claims.push({
      id,
      testCell,
      path: TEST_PATH.exec(testCell)?.[1] ?? null,
      description: TEST_NAME.exec(testCell)?.[1] ?? null,
    });
  }

  return claims;
}

const allIds = parseRequirementIds(readRequired(REQUIREMENTS));
const phaseScope = parsePhaseScope(readRequired(ROADMAP), PHASE_NUMBER);
// Already tracked under tests/, so it needs no special treatment.
const claims = parseClaims(readRepoFile("tests/REQUIREMENT-MAP.md"));
const claimedIds = new Set(claims.map((claim) => claim.id));

const fileClaims = claims.filter((claim) => claim.path !== null);

const label = (unmet: string[]) =>
  unmet.length === 0
    ? ""
    : `\n\nUnmet claims:\n${unmet.map((entry) => `  - ${entry}`).join("\n")}`;

describe("GATE-02: every phase requirement claims a test, and the claim is real", () => {
  it("derives a non-empty phase scope from the roadmap and a larger id set from REQUIREMENTS.md", () => {
    expect(phaseScope.length).toBeGreaterThan(0);
    // The full id set must be strictly larger, or the deferred-id case below
    // would pass vacuously because there is nothing to defer.
    expect(allIds.length).toBeGreaterThan(phaseScope.length);
  });

  it("claims a test for every requirement id in the phase scope", () => {
    const unclaimed = phaseScope.filter((id) => !claimedIds.has(id));

    expect(
      unclaimed,
      `Add a row to tests/REQUIREMENT-MAP.md for each of these.${label(unclaimed)}`
    ).toEqual([]);
  });

  it("claims only ids that actually exist in REQUIREMENTS.md", () => {
    const invented = [...claimedIds].filter((id) => !allIds.includes(id));

    expect(
      invented,
      `These rows claim a requirement id that REQUIREMENTS.md does not define.${label(invented)}`
    ).toEqual([]);
  });

  it("finds every claimed test file on disk", () => {
    const missing = fileClaims
      .filter((claim) => !existsSync(resolve(REPO_ROOT, claim.path as string)))
      .map((claim) => `${claim.id} -> ${claim.path}`);

    expect(
      missing,
      `A claim points at a test file that does not exist.${label(missing)}`
    ).toEqual([]);
  });

  it("reads each claimed test file back off disk and finds its it(...) description", () => {
    // The anti-rot check. A test renamed or deleted leaves the table pointing
    // at nothing, which is how a requirement ends up looking covered when it is
    // not.
    const missing = fileClaims
      .filter((claim) => claim.description !== null)
      .filter(
        (claim) =>
          !readRepoFile(claim.path as string).includes(claim.description as string)
      )
      .map((claim) => `${claim.id} -> ${claim.path} -> "${claim.description}"`);

    expect(
      missing,
      `A claim names an it(...) description that is not in the file it cites.${label(missing)}`
    ).toEqual([]);
  });

  it("names every requirement id that is neither claimed nor deferred to a later phase", () => {
    const unaccounted = allIds.filter(
      (id) => !claimedIds.has(id) && !DEFERRED_FAMILY.test(id)
    );

    expect(
      unaccounted,
      [
        "These requirements have no claim and belong to no later phase.",
        "A SEC or GATE id landing here means the milestone would ship untested.",
        "Claim each one in tests/REQUIREMENT-MAP.md.",
        "",
        ...unaccounted,
      ].join("\n")
    ).toEqual([]);
  });

  it("tolerates PWD, ABT, UPL and LOG as unclaimed leftovers", () => {
    // Spelled out rather than folded into the case above: an empty tolerance
    // list would make that case pass for the wrong reason if the parse ever
    // stopped finding deferred ids.
    const deferred = allIds.filter((id) => !claimedIds.has(id));

    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.filter((id) => !DEFERRED_FAMILY.test(id))).toEqual([]);
  });

  it("points every SEC row at a file under tests/security/", () => {
    // A structural proxy for revert detection, and only that. It says a SEC
    // requirement is claimed by the security suite rather than by a file that
    // happens to pass; it does NOT prove the test fails when the fix is
    // reverted. The real GATE-02 evidence is the revert-detection run
    // recorded in the 01-03 and 01-04 summaries, which the phase verifier
    // reads.
    const offProxy = claims
      .filter((claim) => claim.id.startsWith("SEC-"))
      .filter((claim) => !(claim.path ?? "").replace(/\\/g, "/").startsWith("tests/security/"))
      .map((claim) => `${claim.id} -> ${claim.testCell}`);

    expect(
      offProxy,
      `A SEC requirement is claimed by something outside tests/security/.${label(offProxy)}`
    ).toEqual([]);
  });
});
