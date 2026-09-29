# Requirement Map

Which test proves which requirement. This file is data, not prose:
`tests/security/requirements-coverage.test.ts` parses it and fails when a claim
goes stale.

The Test column names a file and, where the file is a test, the exact `it(...)`
description inside it. Both are read from disk at run time, so renaming a test
turns this table red instead of letting it quietly rot. Descriptions are copied
verbatim from the test source — paraphrasing them here would be a lie the
coverage test cannot detect.

Rows for PWD, ABT, UPL and LOG are deliberately absent. Those requirements belong
to Phases 2 through 5 and have no test yet; claiming them would be a lie. The
coverage test names them as tolerated leftovers instead of ignoring them.

A row whose Test column is a command rather than a `.ts` path (GATE-03) is held
only to the "the id appears in this table" rule.

| Requirement | Test | Assertion |
|-------------|------|-----------|
| SEC-01 | `tests/security/session-boundary.test.ts` > "%s returns 401 and the fixed error envelope" | All 9 protected handlers answer 401 with the guard's exact body, and no Prisma read or write happens |
| SEC-01 | `tests/security/route-enumeration.test.ts` > "$label returns 401 and the fixed error envelope" | Filesystem-discovered sweep over app/api, exact count of 13 route files; a route added without a guard fails here |
| SEC-02 | `tests/security/session-boundary.test.ts` > "%s is not refused when a session exists" | A session exists, so none of the 9 protected handlers answers 401 |
| SEC-02 | `tests/security/session-boundary.test.ts` > "serves the contact list from Prisma with a session" | The guard lets the handler through far enough to run exactly one contact findMany |
| SEC-03 | `tests/security/session-boundary.test.ts` > "serves GET /api/health with no session" | /api/health answers 200 with no session cookie |
| SEC-03 | `tests/security/session-boundary.test.ts` > "registers a new user through POST /api/auth/register with no session" | /api/auth/register answers 201 and really writes the user row |
| SEC-03 | `tests/security/session-boundary.test.ts` > "%s never references requireApiSession" | No public route file references the guard, including the NextAuth catch-all |
| SEC-03 | `tests/security/route-enumeration.test.ts` > "$label answers with something other than 401 when called with no session" | The same claim re-derived from the filesystem, behaviourally: every route on the exact allowlist is invoked with no session and must not answer 401, rather than merely omitting the string requireApiSession from its source |
| SEC-03 | `tests/security/route-enumeration.test.ts` > "exempts no route that merely lives under a public namespace" | A route dropped under /api/auth or /api/health is classified protected unless its exact path is on PUBLIC_API_PATHS, so it cannot be exempted on arrival |
| SEC-04 | `tests/security/role-boundary.test.ts` > "returns 403 with the Forbidden envelope for a USER session on an ADMIN-only route" | A USER session is a permission failure, not an authentication failure |
| SEC-04 | `tests/security/role-boundary.test.ts` > "returns 403 for a DEVELOPER session on an ADMIN-only route" | DEVELOPER holds no ADMIN rights; a guard written as "reject unless ADMIN" that admitted DEVELOPER fails here |
| SEC-04 | `tests/security/role-boundary.test.ts` > "returns 401, not 403, when the required role list is empty" | The session check precedes the role check, so an empty role list cannot turn an anonymous 401 into a 403 |
| SEC-05 | `tests/security/cookie-integrity.test.ts` > "returns no session for a tampered cookie" | A real JWE decode of a tampered ciphertext yields no session |
| SEC-05 | `tests/security/cookie-integrity.test.ts` > "401 when the cookie is tampered" | The tampered cookie reaches a real guarded handler and gets 401 |
| SEC-05 | `tests/security/cookie-integrity.test.ts` > "401 when the cookie is signed with another secret" | A self-consistent cookie the attacker minted is refused, which a tamper-only test never reaches |
| SEC-05 | `tests/security/cookie-integrity.test.ts` > "401 when the cookie is expired" | Expiry clears jose's 15s clock tolerance, so the case cannot pass for the wrong reason |
| SEC-06 | `tests/security/route-enumeration.test.ts` > "discovers every app/api/**/route.ts from the filesystem" | The handler set is walked off disk at run time, so no hand-written list can go stale |
| SEC-06 | `tests/security/route-enumeration.test.ts` > "matches the public allowlist by exact equality, not by prefix" | /api/healthz and a namespace child of /api/auth are not exempted; the allowlist is a set of exact paths, so it cannot widen on its own |
| GATE-01 | `tests/smoke.test.ts` > "resolves the @ alias to the repository root" | The alias the whole suite imports through resolves from a clean checkout |
| GATE-01 | `tests/smoke.test.ts` > "replaces the prisma singleton with an offline fake" | The Prisma client is mocked, so no socket is opened without DATABASE_URL |
| GATE-02 | `tests/security/requirements-coverage.test.ts` > "claims a test for every requirement id in the phase scope" | Every id on the Phase 1 requirements line in ROADMAP.md has a row in this table |
| GATE-02 | `tests/security/requirements-coverage.test.ts` > "reads each claimed test file back off disk and finds its it(...) description" | A renamed or deleted test cannot leave a claim pointing at nothing |
| GATE-03 | `npm run lint` over `eslint.config.mjs` | Non-zero exit on a real rule violation. A type error cannot fail this gate: the config is not type-aware, which is why the falsification proof plants a rule violation rather than a type mismatch |
| GATE-04 | `tests/ci/deploy-workflow.test.ts` > "runs all three gates inside the verify job" | typecheck, lint and test all run inside one blocking verify job |
| GATE-04 | `tests/ci/deploy-workflow.test.ts` > "makes the image build depend on the gate" | build-and-push declares needs: verify |
| GATE-05 | `tests/ci/deploy-workflow.test.ts` > "does not gate the build by anything weaker than the whole verify job" | The needs value is exactly verify, not a matrix leg and not a second entry overriding it |
| GATE-06 | `tests/smoke.test.ts` > "removes the credentials that would allow a live call" | OPENAI_API_KEY and RABBITMQ_URL are undefined in the test process |
