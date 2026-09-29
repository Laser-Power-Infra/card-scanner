# Roadmap: Card Scanner

## Overview

This milestone is a security-hardening pass over a working brownfield app. No product
features. Five phases, ordered by dependency first and blast radius second:

1. **Verification harness + auth boundary** — the test runner, ESLint config, and CI gate land
   in the same phase as the first fix that needs them, so no security change ever ships
   unverified. Every later phase depends on both the gates and a real session boundary.

2. **Password recovery** — highest remaining blast radius. Either privileged role becomes
   full account control; the token flow that echoed reset links in responses and stdout dies
   here, along with its database table.

3. **Upload guard** — a four-line relocation that must land before throttling so the two
   `/api/scan` edits do not fight over guard ordering.

4. **Abuse controls** — rate limiting on the cost-bearing and auth paths, with restart-durable
   state and no new external infrastructure.

5. **Secret hygiene** — the repo-wide log sweep plus the permanent credential-scanner test.

Nothing here is a refactor. PROJECT.md keeps business logic in the route handlers deliberately,
so each phase's diff stays reviewable on its own.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, 4, 5): planned milestone work
- Decimal phases (e.g. 2.1): urgent insertions, marked INSERTED

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Verification Harness and Auth Boundary** - Add the test runner, ESLint config, and CI gate, then close the unauthenticated `/api/*` surface.
- [ ] **Phase 2: Role-Gated Password Recovery** - Replace the token flow with an ADMIN/DEVELOPER-gated reset to an env-var default, and delete the token endpoint, page, and table.
- [ ] **Phase 3: Upload Size Guard** - Enforce the 8MB cap above both the image and spreadsheet branches, before any buffer read or parse.
- [ ] **Phase 4: Abuse Controls** - Throttle sign-in, registration, scan, and enrichment with restart-durable state and no new infrastructure.
- [ ] **Phase 5: Secret Hygiene** - Strip credentials from every log path and add a test that fails the build on a credential-shaped string.

## Phase Details

### Phase 1: Verification Harness and Auth Boundary

**Goal**: Every `/api/*` route except `/api/auth/*` and `/api/health` rejects unauthenticated callers before route logic runs, and the repo can prove it with a test suite, a linter, a typecheck, and a blocking CI stage.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06
**Success Criteria** (what must be TRUE):

  1. On a machine with no live OpenAI key, no RabbitMQ instance, and no outbound internet access, a fresh `git clone` followed by `npm ci && npm test` runs green; each of `npm test`, `npm run lint`, and `npx tsc --noEmit` exits non-zero when its corresponding fix is reverted, and `npm run lint` is not a silent no-op.
  2. A CI run in which any of the three gates fails never reaches the Docker build-and-push job; the deploy is blocked, and a run in which all three pass deploys exactly as it does today.
  3. An unauthenticated `POST /api/scan` returns 401, creates no `Contact` row, and issues no OpenAI call; an unauthenticated `GET /api/contacts` returns 401 with no contact data in the body.
  4. `GET /api/health` and every `/api/auth/*` route — the NextAuth handler, register, and the reset endpoint — still respond normally with no session cookie, and an authenticated request to any `/api/*` route reaches its handler and behaves as it did before.
  5. A non-ADMIN session on an ADMIN-only route receives 403 rather than 401, a tampered or expired session cookie receives 401, and the route-enumeration test discovers every handler from the filesystem so a newly added `app/api/**/route.ts` is covered without editing a hand-written list.

**Plans**: 5/5 plans executed

Plans:

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [x] 01-04-PLAN.md
- [x] 01-05-PLAN.md
- [x] 01-01: Install a test runner, add the ESLint config, and wire `npm test` / `npm run lint` / `npx tsc --noEmit` so all three run offline
- [x] 01-02: Add the blocking CI stage before the build-and-push job; prove a failing gate stops the deploy
- [x] 01-03: Enforce the session boundary across `app/api/**`, keeping `/api/auth/*` and `/api/health` public
- [x] 01-04: Enforce the ADMIN role check (403 vs 401) and reject tampered or expired session cookies
- [ ] 01-05: Add the filesystem-driven route-enumeration test and the regression test for each SEC requirement

### Phase 2: Role-Gated Password Recovery

**Goal**: A non-privileged user cannot reset any account by any route, an ADMIN or DEVELOPER can reset any account from a user list to an env-var default, and no credential or reset link appears in a response body, a log, or the repository.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PWD-01, PWD-02, PWD-03, PWD-04, PWD-05, PWD-06, PWD-07, PWD-08, PWD-09, PWD-10
**Success Criteria** (what must be TRUE):

  1. A regular USER who submits the forgot-password form sees a "contact admin for password reset" message, no account is modified, and an unknown email yields an indistinguishable response so the form cannot be used to enumerate accounts.
  2. The reset endpoint answers 401 with no session, 403 with a USER session, and accepts an ADMIN or DEVELOPER session; the role check runs inside the handler before any password write, so a direct call with a non-privileged session is rejected regardless of what the UI displays.
  3. An ADMIN or DEVELOPER selects an arbitrary account from a user list and resets it; that account then signs in with the default password, and no other account's password is altered by the same action.
  4. The plaintext default appears in no response body, no server log at any level, and no tracked source file; the database receives only a bcrypt hash, and the success response shape is identical for a caller who performed a reset and one who did not.
  5. The token-flow surface is gone — the `reset-password` endpoint, its page, and the `PasswordResetToken` table are deleted and a Prisma migration drops the table — and every bcrypt hash the app writes uses one cost factor, applied identically in register and reset.
  6. A cross-site request carrying an ADMIN's session cookie cannot trigger a reset: a POST from a foreign Origin is rejected and no password changes, proving the reset endpoint is not reachable through a third-party page.

**Plans**: 4 plans

Plans:

- [ ] 02-01: Replace the forgot-password flow with the contact-admin response and add the role-gated reset endpoint with server-side enforcement
- [ ] 02-02: Build the ADMIN/DEVELOPER user list and reset action; remove the reset link from the response body and stdout
- [ ] 02-03: Source the default password from the environment variable, write only a bcrypt hash, and unify the bcrypt cost factor
- [ ] 02-04: Delete the token endpoint, page, and `PasswordResetToken` table; run the migration and regenerate the Prisma client

### Phase 3: Upload Size Guard

**Goal**: A request over 8MB is rejected with 413 before any buffer read, base64 conversion, or spreadsheet parse runs, on both the image and the spreadsheet branch.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: UPL-01, UPL-02, UPL-03, UPL-04
**Success Criteria** (what must be TRUE):

  1. A multipart `POST /api/scan` declaring a `Content-Length` above 8MB is rejected with 413 before the body is fully buffered.
  2. An oversized file sent with no `Content-Length` or a chunked one is rejected with 413 on both branches: no base64 conversion runs on the image path and no XLSX parse runs on the spreadsheet path.
  3. A test asserts the guard's position in the source above the spreadsheet parse currently at `app/api/scan/route.ts:198`, and that test fails if the guard is moved back down to its current position at `:341`.
  4. A 7MB image and a 7MB spreadsheet still scan successfully, so the guard rejects only what is genuinely oversized.

**Plans**: 2 plans

Plans:

- [ ] 03-01: Move the size guard above both branches and reject on declared `Content-Length` before buffering
- [ ] 03-02: Add the positional regression test and the boundary tests for a 7MB and an 8MB+ file on each branch

### Phase 4: Abuse Controls

**Goal**: Failed sign-ins, registrations, scans, and enrichments are throttled at their cost, the limit survives a restart, and the limiter needs no server that must be operated separately.
**Mode:** mvp
**Depends on**: Phase 1, Phase 3
**Requirements**: ABT-01, ABT-02, ABT-03, ABT-04, ABT-05, ABT-06
**Success Criteria** (what must be TRUE):

  1. Repeated failed sign-ins from one source address return 429 once the configured threshold is exceeded, and registration is throttled per source address the same way.
  2. A session that exceeds the scan limit or the profile-enrichment limit receives 429 while a different session's traffic continues normally, and the scan throttle is applied below the size guard so a throttled request is never parsed.
  3. After a container restart, a source that had exhausted its budget is still throttled, proving the limit state is durable rather than held in process memory.
  4. `docker compose up` brings up exactly the services it brings up today — no Redis, no memcached, and no other new datastore appears in the compose file or the required environment variables.
  5. `npm test` covers every ABT requirement and passes with no broker running, no Redis running, and no outbound internet access.

**Plans**: 3 plans

Plans:

- [ ] 04-01: Build the restart-durable single-node limiter with no new external service and no new runtime dependency requiring one
- [ ] 04-02: Apply the limiter to failed sign-in and registration, keyed by source address
- [ ] 04-03: Apply the limiter to scan and profile enrichment, keyed by session, positioned below the upload size guard

### Phase 5: Secret Hygiene

**Goal**: No connection string, token, or password reaches any log at any level, and a test fails the build the moment one does.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: LOG-01, LOG-02, LOG-03
**Success Criteria** (what must be TRUE):

  1. `docker logs` across a full scan-and-enrich cycle contains no `postgres://` or `amqp://` string with embedded credentials, no `sk-` API key, no JWT, and no `password` or `passwordHash` value at any level.
  2. The RabbitMQ connection line reports host and port only — `[RabbitMQ] connected to localhost:5672` — and never the full URL that `lib/rabbitmq.ts:8` logs today.
  3. The unconditional debug dumps that print field values — the full extracted card at `lib/extractCard.ts:126-128` and the full queue payload at `app/actions/profile-collection.ts:66-68` — no longer emit credential-shaped data.
  4. An automated test captures output from the log-emitting paths, scans it for credential-shaped patterns, and fails the build on a match; deliberately re-inserting the full `RABBITMQ_URL` into a log call makes that test fail.

**Plans**: 2 plans

Plans:

- [ ] 05-01: Remove the full-URL log at `lib/rabbitmq.ts:8` and sweep every other log call site for credential-shaped output
- [ ] 05-02: Add the credential-pattern log scanner test and prove it fails on a deliberately reintroduced leak

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Verification Harness and Auth Boundary | 5/5 | In Progress|  |
| 2. Role-Gated Password Recovery | 0/4 | Not started | - |
| 3. Upload Size Guard | 0/2 | Not started | - |
| 4. Abuse Controls | 0/3 | Not started | - |
| 5. Secret Hygiene | 0/2 | Not started | - |

---

*Roadmap created: 2026-09-29 — 35 v1 requirements, 5 phases, 16 plans planned*
