# Requirements: Card Scanner

**Defined:** 2026-09-29
**Core Value:** An uploaded business card becomes a correct, deduplicated, geolocated contact — with zero manual retyping.

## v1 Requirements

This milestone is a security-hardening pass over an existing brownfield app. No product features are added.

### Auth Boundary

- [x] **SEC-01**: Unauthenticated request to any `/api/*` route other than `/api/auth/*` and `/api/health` returns 401, without executing route logic
- [x] **SEC-02**: Authenticated request to any `/api/*` route reaches its handler normally
- [x] **SEC-03**: `/api/auth/*` and `/api/health` remain reachable without a session
- [x] **SEC-04**: Non-ADMIN session requesting an ADMIN-only route is rejected with 403, not 401
- [x] **SEC-05**: A tampered or expired session cookie is rejected and the request receives 401
- [x] **SEC-06**: The auth boundary holds for every route registered under `app/api/**`, verified by a test that enumerates the routes rather than asserting a hand-written list

### Password Recovery

> **Note.** PWD-04 grants ADMIN and DEVELOPER the ability to reset any account to a known
> default. Either role is therefore equivalent to full account control. This follows the
> existing role model, where DEVELOPER already gates the bulk-research server action.

- [ ] **PWD-01**: A non-ADMIN, non-DEVELOPER user who submits the forgot-password form sees a "contact admin for password reset" message, and no account is modified
- [ ] **PWD-02**: An unauthenticated request to the reset endpoint is rejected with 401
- [ ] **PWD-03**: An authenticated ADMIN or DEVELOPER request to the reset endpoint is accepted
- [ ] **PWD-04**: An ADMIN or DEVELOPER can select any account from a user list and reset it, and the target returns to the default password
- [ ] **PWD-05**: The role check is enforced inside the handler, so calling the endpoint directly with a non-privileged session is rejected regardless of what the UI shows
- [ ] **PWD-06**: The default password is read from an environment variable and is absent from the repository, all source files, and every log
- [ ] **PWD-07**: The reset writes only a bcrypt hash to the database; the plaintext default is never persisted outside the environment variable, and no credential appears in any response body
- [ ] **PWD-08**: The reset endpoint no longer writes the reset link or any credential to the server console
- [ ] **PWD-09**: The token-based `reset-password` endpoint and its `PasswordResetToken` table are removed, since the token flow is no longer reachable
- [ ] **PWD-10**: All password hashing uses one bcrypt cost factor, applied consistently across register and reset

### Abuse Controls

- [ ] **ABT-01**: Repeated failed sign-in attempts from one source are throttled, and the throttled response returns 429
- [ ] **ABT-02**: Registration is throttled per source address
- [ ] **ABT-03**: The scan endpoint is throttled per session, and exceeding the limit returns 429
- [ ] **ABT-04**: The profile-enrichment endpoint is throttled per session
- [ ] **ABT-05**: Rate-limit state survives a process restart, so a redeploy is not a reset button
- [ ] **ABT-06**: Rate limiting requires no new runtime dependency that needs an external server to operate

### Upload Guard

- [ ] **UPL-01**: A file larger than 8MB is rejected with 413 before any buffer read, base64 conversion, or spreadsheet parse occurs
- [ ] **UPL-02**: The size guard applies to the spreadsheet branch as well as the image branch
- [ ] **UPL-03**: A request declaring an oversized `Content-Length` is rejected before the body is fully buffered
- [ ] **UPL-04**: Oversized rejection is covered by an automated test that fails if the guard moves below the parse call

### Secret Hygiene

- [ ] **LOG-01**: No connection string, token, or password is written to any log at any level
- [ ] **LOG-02**: The RabbitMQ connection log reports host and port only, never the full URL
- [ ] **LOG-03**: An automated test scans log output for credential-shaped strings and fails on a match

### Verification Gates

- [x] **GATE-01**: A test runner is installed with an `npm test` script that runs from a clean checkout
- [x] **GATE-02**: Tests exist for every SEC, PWD, ABT, and UPL requirement, and each one fails when its fix is reverted
- [x] **GATE-03**: An ESLint config exists and `npm run lint` exits non-zero on a real violation
- [ ] **GATE-04**: CI runs tests, lint, and typecheck as a blocking stage before the build-and-push job
- [ ] **GATE-05**: CI fails the deployment when any of the three gates fail
- [x] **GATE-06**: The security test suite needs no live OpenAI key, RabbitMQ instance, or outbound internet access

## v2 Requirements

Deferred. Acknowledged, not in this roadmap.

### Hygiene

- **HYG-01**: `lib/permissions.ts` helpers (`requireAuth`, `requireAdmin`) are either adopted by the route handlers or deleted
- **HYG-02**: The four overlapping geocode endpoints under `app/api/locations/` are consolidated to one
- **HYG-03**: `dotenv` is declared explicitly in `package.json` rather than relied on transitively
- **HYG-04**: `README.md` is corrected to match the actual stack (OpenAI, PostgreSQL, ports 4000/4111, no Python service)

### Structural

- **STR-01**: Business logic moves out of route handlers into `lib/`
- **STR-02**: The app migrates off client-authoritative state to React Server Components
- **STR-03**: The duplicated NextAuth config in `lib/auth.ts` and `app/api/auth/[...nextauth]/route.ts` becomes a single source

## Out of Scope

| Feature | Reason |
|---------|--------|
| React 19 upgrade | React 18.3.1 is what the current client components depend on; unrelated to the security work |
| Rewriting the external RabbitMQ consumer | It lives in a separate repository |
| Outbound mail provider (Nodemailer, Resend, SendGrid) | No provider credentials exist; the admin-gated reset removes the need for consumer-facing delivery |
| OAuth or SSO login | Credentials auth is sufficient for this app's single-operator usage |
| Extraction of business logic into `lib/` | Doing it on the same routes as the security change would obscure the security diff |
| RSC / server-side data layer migration | Large refactor, not a fix |
| Any new product feature | This milestone is a security pass; features come after |
| Redis or external rate-limit store | ABT-05 requires restart-durable state, but a single-node durable store is sufficient and avoids new infrastructure |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| SEC-04 | Phase 1 | Complete |
| SEC-05 | Phase 1 | Complete |
| SEC-06 | Phase 1 | Complete |
| PWD-01 | Phase 2 | Pending |
| PWD-02 | Phase 2 | Pending |
| PWD-03 | Phase 2 | Pending |
| PWD-04 | Phase 2 | Pending |
| PWD-05 | Phase 2 | Pending |
| PWD-06 | Phase 2 | Pending |
| PWD-07 | Phase 2 | Pending |
| PWD-08 | Phase 2 | Pending |
| PWD-09 | Phase 2 | Pending |
| PWD-10 | Phase 2 | Pending |
| UPL-01 | Phase 3 | Pending |
| UPL-02 | Phase 3 | Pending |
| UPL-03 | Phase 3 | Pending |
| UPL-04 | Phase 3 | Pending |
| ABT-01 | Phase 4 | Pending |
| ABT-02 | Phase 4 | Pending |
| ABT-03 | Phase 4 | Pending |
| ABT-04 | Phase 4 | Pending |
| ABT-05 | Phase 4 | Pending |
| ABT-06 | Phase 4 | Pending |
| LOG-01 | Phase 5 | Pending |
| LOG-02 | Phase 5 | Pending |
| LOG-03 | Phase 5 | Pending |
| GATE-01 | Phase 1 | Complete |
| GATE-02 | Phase 1 | Complete |
| GATE-03 | Phase 1 | Complete |
| GATE-04 | Phase 1 | Pending |
| GATE-05 | Phase 1 | Pending |
| GATE-06 | Phase 1 | Complete |

**Coverage:**

- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1. Verification Harness and Auth Boundary | GATE-01..06, SEC-01..06 | 12 |
| 2. Role-Gated Password Recovery | PWD-01..10 | 10 |
| 3. Upload Size Guard | UPL-01..04 | 4 |
| 4. Abuse Controls | ABT-01..06 | 6 |
| 5. Secret Hygiene | LOG-01..03 | 3 |

---
*Requirements defined: 2026-09-29*
*Last updated: 2026-09-29 after roadmap creation*
