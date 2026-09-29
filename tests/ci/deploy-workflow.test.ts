import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Line endings are normalized before any matching. The repo has no
// `.gitattributes` and `core.autocrlf` is true on the Windows dev machine, so
// the file is CRLF in a working tree and LF in the ubuntu-latest checkout. The
// line-level assertions below must hold identically in both.
const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "deploy.yml"),
  "utf8"
).replace(/\r\n/g, "\n");

// Isolate one job block: from `^  <name>:` up to the next `^  <name>:` or `^jobs:`.
function jobBlock(name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `job "${name}" not found in deploy.yml`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(
    (line) => /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * The body of the `jobs:` mapping, and nothing above it.
 *
 * Scoping matters: `on.push` is also indented two spaces, so scanning the whole
 * file for `^ {2}<key>:` would read the trigger as a job and report it as a job
 * with no permissions block.
 */
function jobsSection(): string {
  const lines = workflow.split("\n");
  const start = lines.indexOf("jobs:");
  expect(start, "no top-level `jobs:` key in deploy.yml").toBeGreaterThan(-1);
  return lines.slice(start + 1).join("\n");
}

function jobNames(): string[] {
  return jobsSection()
    .split("\n")
    .map((line) => /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

/**
 * The `<scope>: <value>` pairs a job's own `permissions:` block grants, or an
 * empty array when the job declares no block at all. Reads to the first line
 * that is not indented six spaces, so it cannot run past the block.
 */
function permissionScopes(name: string): string[] {
  const lines = jobBlock(name).split("\n");
  const start = lines.findIndex((line) => /^ {4}permissions:\s*$/.test(line));

  if (start === -1) return [];

  const scopes: string[] = [];

  for (const line of lines.slice(start + 1)) {
    const entry = /^ {6}([a-z-]+):\s*(\S+)\s*$/.exec(line);

    if (!entry) break;
    scopes.push(`${entry[1]}: ${entry[2]}`);
  }

  return scopes;
}

/**
 * The single step in `job` that runs `command`: from that step's own
 * `- name:` / `- run:` marker up to (not including) the next step marker, or
 * the end of the job.
 *
 * The slice is the point. `if:` and `continue-on-error:` are step properties,
 * so a whole-job regex cannot distinguish "the gate is behind an `if:`" from
 * "some unrelated step in the same job is". Returns "" when no step runs the
 * command, which the assertions below turn into a named failure.
 */
function stepBlock(job: string, command: string): string {
  const lines = job.split("\n");
  const at = lines.findIndex((line) => line.includes(command));

  if (at === -1) return "";

  // Walk back to the step's opening marker, so a command appearing in a later
  // line of the same step is attributed to that step and not to the next one.
  let open = at;

  while (open > 0 && !/^ {6}- /.test(lines[open])) open -= 1;

  const rest = lines.slice(open + 1);
  const end = rest.findIndex((line) => /^ {6}- /.test(line));

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * Every way a step can be present in the file and still be unable to fail its
 * job. Anchored to the 8-space step-property indent so a `if` inside a
 * PowerShell or bash script body is not mistaken for a step condition.
 */
const MASKING_STEP_KEYS = /^ {8}(continue-on-error:|if:)/m;
const MASKING_SHELL_SUFFIX = /\|\|\s*true/;

describe("deploy workflow gate", () => {
  it("declares a verify job", () => {
    expect(workflow).toMatch(/^ {2}verify:\s*$/m);
  });

  it("runs all three gates inside the verify job", () => {
    const verify = jobBlock("verify");
    expect(verify).toMatch(/npm run typecheck/);
    expect(verify).toMatch(/npm run lint/);
    expect(verify).toMatch(/npm test/);
  });

  it("runs each gate on a step that can actually fail the job", () => {
    // The substring checks above are satisfied by a gate command that appears
    // in a comment, in an `echo`, or on a step GitHub will not fail the job
    // for. GATE-04 and GATE-05 exist to prevent exactly that, so the step each
    // gate lives on is asserted to be unconditional and fatal-on-failure.
    const verify = jobBlock("verify");

    for (const gate of ["npm run typecheck", "npm run lint", "npm test"]) {
      const step = stepBlock(verify, gate);

      expect(step, `no step in verify runs \`${gate}\``).not.toBe("");
      expect(
        step,
        `\`${gate}\` must run unconditionally: an \`if:\` or ` +
          `\`continue-on-error:\` on its step makes the gate decorative.`
      ).not.toMatch(MASKING_STEP_KEYS);
      expect(
        step,
        `\`${gate}\` must not swallow its own failure with \`|| true\`.`
      ).not.toMatch(MASKING_SHELL_SUFFIX);
    }
  });

  it("has no step anywhere in verify that can mask a failure", () => {
    // Job-level, so a masking step added next to the gates is caught even
    // before someone points a gate command at it.
    const verify = jobBlock("verify");

    expect(
      verify,
      "an `if:` or `continue-on-error:` in the verify job makes the gate decorative"
    ).not.toMatch(MASKING_STEP_KEYS);
    expect(verify, "`|| true` in the verify job swallows a failing gate")
      .not.toMatch(MASKING_SHELL_SUFFIX);
  });

  it("has no step anywhere in build-and-push that can mask a failure", () => {
    // `needs: verify` is only a gate if verify can actually go red, and only
    // blocks the image if the build job's own steps are fatal-on-failure too.
    // `deploy` is deliberately not covered: its image-prune step is best-effort
    // by design, so an `if: always()` there is not the same regression.
    const build = jobBlock("build-and-push");

    expect(
      build,
      "an `if:` or `continue-on-error:` in build-and-push lets the image ship past a failure"
    ).not.toMatch(MASKING_STEP_KEYS);
    expect(build, "`|| true` in build-and-push swallows a failing build step")
      .not.toMatch(MASKING_SHELL_SUFFIX);
  });

  it("installs from the lockfile so the gate matches the image build", () => {
    expect(jobBlock("verify")).toMatch(/npm ci/);
  });

  it("makes the image build depend on the gate", () => {
    expect(jobBlock("build-and-push")).toMatch(/^ {4}needs: verify\s*$/m);
  });

  it("keeps the deploy job downstream of the build", () => {
    expect(jobBlock("deploy")).toMatch(/^ {4}needs: build-and-push\s*$/m);
  });

  it("does not gate the build by anything weaker than the whole verify job", () => {
    // Guards against `needs: [verify]` being quietly narrowed to a matrix leg
    // that does not exist, or a second needs entry overriding the first.
    const needs = jobBlock("build-and-push").match(/^ {4}needs:(.*)$/m);
    expect(needs).not.toBeNull();
    expect(needs![1].trim()).toBe("verify");
  });

  it("scopes packages: write to the build job alone", () => {
    // A workflow-level `permissions:` grants every job, including the one that
    // executes freshly installed dependencies. Assert it is not reintroduced.
    expect(workflow).not.toMatch(/^permissions:\s*$/m);
    expect(jobBlock("verify")).not.toMatch(/packages: write/);
    expect(jobBlock("build-and-push")).toMatch(/packages: write/);
  });

  it("gives every job an explicit permissions block", () => {
    // A job with no `permissions:` inherits whatever the *repository* default
    // token scope happens to be, which is invisible in this file and changes
    // without a commit. Removing the workflow-level block in Phase 1 is what
    // made `deploy` fall through to that default in the first place, so the
    // regression has to be caught per job, not once at the top of the file.
    const names = jobNames();

    expect(names).toEqual(
      expect.arrayContaining(["verify", "build-and-push", "deploy"])
    );

    const implicit = names.filter(
      (name) => !/^ {4}permissions:\s*$/m.test(jobBlock(name))
    );

    expect(
      implicit,
      "A job with no permissions: block inherits the repository default token " +
        "scope, which is not visible in this file. Give it an explicit block " +
        "listing exactly the scopes it needs."
    ).toEqual([]);
  });

  it("keeps the self-hosted deploy job read-only", () => {
    // The deploy job is the only one on a persistent runner and the one that
    // runs shell against a live server, so its block is pinned rather than
    // merely required to exist: contents: read is all it needs, and anything
    // wider (packages: write, pull-requests: write, ...) is a regression.
    expect(permissionScopes("deploy")).toEqual(["contents: read"]);
  });

  it("never hands a secret to the verify job", () => {
    // The suite is credential-free by construction; a `secrets.` reference here
    // would mean the gate had started depending on a credential.
    expect(jobBlock("verify")).not.toMatch(/secrets\./);
  });
});
