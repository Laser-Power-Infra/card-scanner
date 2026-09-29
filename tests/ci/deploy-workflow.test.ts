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

  it("never hands a secret to the verify job", () => {
    // The suite is credential-free by construction; a `secrets.` reference here
    // would mean the gate had started depending on a credential.
    expect(jobBlock("verify")).not.toMatch(/secrets\./);
  });
});
