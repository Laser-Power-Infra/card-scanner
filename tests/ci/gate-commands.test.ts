import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest"

/**
 * GATE-03: the lint gate has a claim the suite used to be unable to check.
 *
 * GATE-01, GATE-04, GATE-05 and GATE-06 were each pointed at a real `it(...)`
 * by the time this file was written. GATE-03's row in tests/REQUIREMENT-MAP.md
 * held a command (`npm run lint` over `eslint.config.mjs`), and the coverage
 * test's TEST_PATH / TEST_NAME patterns find no `.ts` path and no quoted
 * description in such a cell -- so the one row the file exists to make
 * falsifiable was held only to "the string GATE-03 appears somewhere in the
 * table". That is the tautology the rest of requirements-coverage.test.ts is
 * built to eliminate.
 *
 * This closes it from the half that is statically checkable and stable: the
 * three gate commands must exist in package.json, must be real invocations of
 * the tool they claim to run, must be unable to swallow their own failure, and
 * must be the commands the CI `verify` job actually runs.
 *
 * Why there is no in-suite ESLint subprocess here. The obvious way to make
 * GATE-03 behavioural is to plant a violation and shell out to `npm run lint`
 * from a test. That is deliberately not done, for three reasons:
 *
 *   - `lint` is `eslint .`, so the probe would lint the whole project a second
 *     time inside the very test CI already runs lint for.
 *   - it plants a file in the working tree during `npm test`, where a crash or
 *     a hard kill leaves it behind for the next typecheck to pick up.
 *   - ESLint exits 2 on a CONFIG error as well as on a rule violation, so a
 *     plain "non-zero" assertion would pass for the wrong reason every time
 *     eslint.config.mjs is mid-edit -- which is a real state on this branch.
 *
 * The behavioural half is therefore recorded once, by hand, in
 * 01-FIXES-MEDIUM-A.md: `npm run lint` exits 0 on the tree and exits 1 with a
 * `no-unused-vars` report when that rule is violated. What this file guarantees
 * is the part that would otherwise be unverifiable -- that the command being
 * claimed is the command CI runs, and that it is a real eslint invocation
 * against a real config rather than a decorated no-op.
 *
 * Nothing in this file asserts an exact script string. The `typecheck` script in
 * particular is under active revision (ME-05), and a test that pinned
 * `prisma generate && next typegen && tsc --noEmit` verbatim would fail on a
 * change that made the gate stronger rather than weaker.
 */

// Line endings are normalized before matching, for the same reason
// tests/ci/deploy-workflow.test.ts does it: there is no .gitattributes, so the
// workflow is CRLF in a Windows working tree and LF in the ubuntu-latest
// checkout. Every pattern below must hold identically in both.
const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "deploy.yml"),
  "utf8"
).replace(/\r\n/g, "\n");

const eslintConfigPath = join(process.cwd(), "eslint.config.mjs");
const eslintConfig = existsSync(eslintConfigPath)
  ? readFileSync(eslintConfigPath, "utf8")
  : "";

type PackageJson = { scripts?: Record<string, string> };

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8")
) as PackageJson;

/** Isolate one job block: from `^  <name>:` to the next `^  <name>:`. */
function jobBlock(name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);

  expect(start, `job "${name}" not found in deploy.yml`).toBeGreaterThan(-1);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line));

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * The single step in `job` that runs `command`: from that step's own
 * `- name:` / `- run:` marker up to the next step marker.
 *
 * A substring match over the whole job would be satisfied by a gate command in
 * a comment or an `echo`, which is the failure tests/ci/deploy-workflow.test.ts
 * already pins (HI-03). What this file adds is the package.json half, so the
 * step lookup is kept small and the real work is the assertion below.
 */
function stepBlock(job: string, command: string): string {
  const lines = job.split("\n");
  const at = lines.findIndex((line) => line.includes(command));

  if (at === -1) return "";

  let open = at;
  while (open > 0 && !/^ {6}- /.test(lines[open])) open -= 1;

  const rest = lines.slice(open + 1);
  const end = rest.findIndex((line) => /^ {6}- /.test(line));

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

type Gate = {
  /** The package.json script name. */
  script: string;
  /** The exact command the CI verify job runs. */
  ci: string;
  /** What the script must invoke for the gate to mean anything. */
  required: RegExp[];
  /** Invocations that would make the gate decorative. */
  forbidden: RegExp[];
  /** Why it is forbidden, in the failure message. */
  forbiddenWhy: string;
};

const GATES: Gate[] = [
  {
    script: "test",
    ci: "npm test",
    // `vitest` with no subcommand is WATCH mode: in CI it would hang the job
    // rather than gate it, and locally it never exits. Requiring `run` is what
    // makes `npm test` a gate rather than a process.
    required: [/\bvitest\s+run\b/],
    forbidden: [/\bvitest\s+--watch\b/],
    forbiddenWhy: "a watch-mode vitest never exits, so it cannot gate anything",
  },
  {
    script: "lint",
    ci: "npm run lint",
    required: [/\beslint\b/],
    forbidden: [
      // `next lint` is the deprecated wrapper; it is not what this gate runs
      // and its behaviour is not what GATE-03 was verified against.
      /\bnext\s+lint\b/,
      // Opting out of config discovery lints with no rules at all: every file
      // passes, for the same reason a rule-free config does.
      /--no-config-lookup/,
      /--no-eslintrc/,
    ],
    forbiddenWhy: "it is not the real eslint invocation the gate was verified against",
  },
  {
    script: "typecheck",
    ci: "npm run typecheck",
    required: [/\btsc\b/, /--noEmit/],
    // tsc --watch never terminates, so the gate job would hang instead of pass.
    forbidden: [/\btsc\b[^&|;]*--watch\b/],
    forbiddenWhy: "tsc --watch never terminates, so it cannot gate anything",
  },
];

/**
 * Shell escapes that turn a failing gate green.
 *
 * `&&` is deliberately NOT here: `prisma generate && next typegen && tsc
 * --noEmit` is the correct way to chain, and it propagates failure correctly.
 * What must not appear is anything that discards the exit status.
 */
const FAILURE_NEUTRALISERS: Array<[RegExp, string]> = [
  [/\|\|\s*true\b/, "`|| true` discards the exit status"],
  [/\|\|\s*exit\s+0\b/, "`|| exit 0` discards the exit status"],
  [/;\s*exit\s+0\b/, "`; exit 0` discards the exit status"],
  [/\|\|\s*:/, "`|| :` discards the exit status"],
  [/\bset\s+\+e\b/, "`set +e` discards the exit status"],
  [/\s&\s*$/, "a trailing `&` backgrounds the command, so its exit status is discarded"],
];

/** Anchored to the 8-space step-property indent so an `if` in a run body is not read as a condition. */
const MASKING_STEP_KEYS = /^ {8}(continue-on-error:|if:)/m;

describe("the three CI gates exist as runnable, wired, unfalsifiable commands", () => {
  it("declares every gate script package.json is asked to run", () => {
    const missing = GATES.filter((gate) => !pkg.scripts?.[gate.script]).map(
      (gate) => gate.script
    );

    expect(
      missing,
      `package.json has no script for ${missing.length} gate(s). Each one is ` +
        `invoked by the CI verify job, so a missing script is a broken pipeline, ` +
        `not a missing test.`
    ).toEqual([]);
  });

  it.each(GATES)(
    "runs the real tool in the $script script",
    ({ script, required, forbidden, forbiddenWhy }) => {
      const command = pkg.scripts?.[script] ?? "";

      for (const pattern of required) {
        expect(
          command,
          `\`${script}\` must invoke ${pattern} to be a gate. It is: ${command}`
        ).toMatch(pattern);
      }

      for (const pattern of forbidden) {
        expect(
          command,
          `\`${script}\` is \`${command}\`, and ${forbiddenWhy}.`
        ).not.toMatch(pattern);
      }
    }
  );

  it.each(GATES)(
    "cannot have its failure swallowed in the $script script",
    ({ script }) => {
      const command = pkg.scripts?.[script] ?? "";

      for (const [pattern, why] of FAILURE_NEUTRALISERS) {
        expect(command, `\`${script}\` is \`${command}\`, and ${why}.`).not.toMatch(
          pattern
        );
      }
    }
  );

  it("wires all three gate scripts into the CI verify job", () => {
    const verify = jobBlock("verify");

    for (const gate of GATES) {
      const step = stepBlock(verify, gate.ci);

      expect(
        step,
        [
          `The CI verify job never runs \`${gate.ci}\`, so the \`${gate.script}\``,
          `script this test just verified is not the gate CI actually applies.`,
          `GATE-04 requires all three to run inside one blocking job.`,
        ].join("\n")
      ).not.toBe("");

      // Re-checked here rather than assumed from deploy-workflow.test.ts: that
      // file proves the step cannot mask a failure, this one proves the step
      // names a script that exists, and the two only add up if both hold.
      expect(
        step,
        `\`${gate.ci}\` runs on a step that cannot fail the job.`
      ).not.toMatch(MASKING_STEP_KEYS);
    }
  });

  it("gives the lint gate a real flat config to run against", () => {
    expect(
      existsSync(eslintConfigPath),
      "eslint.config.mjs does not exist, so `npm run lint` has no rules to apply " +
        "and every file passes for the wrong reason."
    ).toBe(true);

    expect(
      eslintConfig.trim().length,
      "eslint.config.mjs is empty."
    ).toBeGreaterThan(0);

    // A config that exports nothing usable lints nothing.
    expect(eslintConfig).toMatch(/export\s+default/);
  });

  it("keeps the lint config non-type-aware, which is why a type error cannot trip it", () => {
    // The claim in GATE-03's row that a TYPE error cannot fail `npm run lint` is
    // only true while the config carries no project information. Asserting it
    // here means the caveat is a checked fact rather than a sentence: if the
    // config ever becomes type-aware, this goes red and the map row has to be
    // rewritten, because the falsification proof it describes -- a planted RULE
    // violation -- would no longer be the only thing that can fail the gate.
    expect(
      eslintConfig,
      [
        "eslint.config.mjs now enables type-aware linting (projectService or",
        "parserOptions.project), so a type error CAN fail `npm run lint`.",
        "Update the GATE-03 row in tests/REQUIREMENT-MAP.md to match: the",
        "falsification proof no longer has to plant a rule violation.",
      ].join("\n")
    ).not.toMatch(/projectService\s*:\s*true/);
    expect(eslintConfig).not.toMatch(/parserOptions[\s\S]{0,200}?\bproject\s*:/);
  });
});
