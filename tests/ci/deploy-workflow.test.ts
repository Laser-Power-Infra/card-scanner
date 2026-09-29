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
