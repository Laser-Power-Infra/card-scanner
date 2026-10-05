# Codebase Concerns

**Analysis Date:** 2026-10-03

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH     | 10 |
| MEDIUM   | 14 |
| LOW      | 8 |

> Scope: full repo (excluding `node_modules/`, `.next/`, `.git/`).
> `.env` exists at the repo root and is consumed by the app; its values were not read and no secret values appear below.

---

## CRITICAL

### C1. Password-reset endpoint returns live credentials to the caller — account takeover of any user

**Severity:** CRITICAL

**What's wrong:** `app/api/auth/forgot-password/route.ts:54-78`:

```ts
const defaultPassword = crypto.randomBytes(12).toString("base64url");
const passwordHash = await bcrypt.hash(defaultPassword, 10);
// ...
return NextResponse.json({
  success: true,
  message: "If an account exists with these details, a password reset link has been generated.",
  defaultPassword,   // <-- live credential handed back to the caller
  token,             // <-- live reset token
  expiresAt: expiry,
});
```

The endpoint correctly avoids email enumeration for unknown addresses (`app/api/auth/forgot-password/route.ts:39-44`), but for any **existing** address it returns a ready-to-use password and reset token in the JSON body. The token is also stored in plaintext in the `PasswordResetToken` table (`prisma/schema.prisma:120`).

**Impact:** `POST /api/auth/forgot-password {"email":"admin@company.com","name":"Admin"}` returns a token; `POST /api/auth/reset-password {"token":"<that>","password":"anything6plus"}` (`app/api/auth/reset-password/route.ts:6-101`) sets a new password. Full ATO for any account whose email is known — including the `ADMIN` account. No email ownership proof, no rate limit on the reset endpoint itself, no logging, no audit trail.

**Fix approach:** delete `defaultPassword` and `token` from the response; ship the token out-of-band via an email provider. Hash the token before storage (`sha256(token)`), delete all pre-existing tokens for that email on issuance, and rate-limit by IP + email.

---

### C2. RabbitMQ connection string (with credentials) logged on every publish attempt

**Severity:** CRITICAL

**What's wrong:** `lib/rabbitmq.ts:8`:

```ts
async function getModel(): Promise<ChannelModel | null> {
  const url = process.env.RABBITMQ_URL;
  console.log("[RabbitMQ] Connecting to:", url);
```

`RABBITMQ_URL` is an AMQP URI, conventionally `amqp://user:password@host/vhost` — i.e. a plaintext broker credential. It is written to stdout on every channel creation. Docker captures container stdout (`docker-compose.yml` has no log driver configured), so the credential lands in whatever collects container logs and survives in the log history of every deploy that has ever run.

**Impact:** broker credential disclosure → queue poisoning, message interception (queue payloads carry full contact PII, `lib/queue/profileCollection.ts:5-11`), or job injection.

**Fix approach:** delete the log line (or redact with `new URL(url).host`). Rotate the broker credential. Add a startup assertion that logs only presence, mirroring the pattern already used at `app/api/scan/route.ts:175`.

---

### C3. No rate limiting on scan/enrich endpoints — OpenAI cost exposure

**Severity:** CRITICAL

**What's wrong:** `lib/rateLimit.ts` exists and is used on the forgot-password route (`app/api/auth/forgot-password/route.ts:47,70`), but the expensive endpoints are unprotected:

- `app/api/scan/route.ts:179` — `POST` with `maxDuration = 60` (`app/api/scan/route.ts:38`), one OpenAI vision call per upload, image or spreadsheet, no per-user cap.
- `app/api/profile/enrich/route.ts:85-114` — one `gpt-5.6-luna` completion per call, `max_tokens: 800`.
- `app/api/locations/batch/route.ts:54-90` — loops **serially** over an unbounded `body.locations` array, each miss hitting Nominatim.
- `app/api/auth/register/route.ts:5` — unlimited account creation; every call runs `bcrypt.hash(password, 12)` (`app/api/auth/register/route.ts:50`), a deliberately CPU-expensive op.

**Impact:** direct, uncapped financial exposure on the OpenAI key; shared-Nominatim blocklist risk; trivial denial of service via `bcrypt` burn on register.

**Fix approach:** apply the existing `lib/rateLimit.ts` (or a shared limiter) per route class: tight (5/min) on auth, moderate (30/min) on scan/enrich, low-cost allowance on geocode.

---

### C4. Unauthenticated, unbounded spreadsheet parsing — memory-exhaustion DoS

**Severity:** CRITICAL

**What's wrong:** `app/api/scan/route.ts:201-203` branches to the spreadsheet path *before* the size guard:

```ts
if (!file.type.startsWith("image/") && isSpreadsheet(file)) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
```

The only `MAX_BYTES = 8 * 1024 * 1024` check (`app/api/scan/route.ts:47`) is applied at `app/api/scan/route.ts:345`, **after** the spreadsheet branch has already returned. So CSV/XLSX uploads are effectively unlimited in size.

Worse, the row loop (`app/api/scan/route.ts:230-322`) issues one `prisma.contact.findFirst` plus one `create` **per row, sequentially**, inside a single HTTP request with no row cap. `orClauses` (`app/api/scan/route.ts:276-287`) is also unbounded — a single row with thousands of email cells produces a giant `OR` list in the generated SQL.

**Impact:** a single anonymous multi-hundred-MB upload can OOM the Node process (`NODE_OPTIONS=--max-old-space-size=4096`, `Dockerfile:29`); a 100k-row workbook holds the request open for minutes and hammers Postgres with 200k round trips.

**Fix approach:** move the size/type gate ahead of both branches; cap `file.size` for spreadsheets; cap row count; wrap row processing in a transaction with `createMany`; truncate `orClauses`.

---

### C5. Public API surface exposes full PII to anonymous callers (by design)

**Severity:** CRITICAL

**What's wrong:** The following endpoints are listed in `PUBLIC_API_PATHS` (`lib/permissions.ts:53-72`) and deliberately do not call `requireApiSession()`:

| Endpoint | Location | What an anonymous caller gets |
|----------|----------|-------------------------------|
| `GET /api/contacts` | `app/api/contacts/route.ts:7` | Every contact row (paginated, but all pages accessible) |
| `GET /api/profile/[id]` | `app/api/profile/[id]/route.ts:5` | Any single contact by cuid |
| `POST /api/scan` | `app/api/scan/route.ts:179` | Billable OpenAI vision calls + write access to contacts table |
| `POST /api/locations/resolve` | `app/api/locations/resolve/route.ts:5` | Nominatim quota burn + permanent DB cache writes |
| `POST /api/locations/cache-check` | `app/api/locations/cache-check/route.ts:4` | Bulk cache probe |

The design intent is documented in `lib/permissions.ts:12-52` — the directory is world-readable on purpose. However, the scan endpoint is the most concerning: an anonymous caller can upload unlimited images, each triggering a billable OpenAI call and a DB write.

**Impact:** complete disclosure of the entire business-card database to the internet; unbounded cost exposure on OpenAI; unauthorized data injection into the `Contact` table.

**Fix approach:** if the public-by-decision stance is intentional, add rate limiting (C3) and a strict upload quota. If not, remove these from `PUBLIC_API_PATHS` and add `requireApiSession()` at the top of each handler.

---

## HIGH

### B1. Phone-number deduplication is silently non-functional in the image path

**Severity:** HIGH

**What's wrong:** `app/api/scan/route.ts:371-374` normalizes phone candidates for the DB query, but the row was written with the *raw* values at `app/api/scan/route.ts:391-392`:

```ts
const mobileCandidates = (data.mobileNumbers ?? []).map((m) => String(m).replace(/[^+0-9]/g, ""));
// ...
for (const m of mobileCandidates) orClauses.push({ mobileNumbers: { has: m } });
```

Prisma's `has` on a Postgres `String[]` is exact element equality. A card storing `"+91 98765 43210"` will never match a query for `"+919876543210"`. The same mismatch applies to `telCandidates` at `app/api/scan/route.ts:373,378`.

The **spreadsheet** path in the same file (`app/api/scan/route.ts:277-279`) does *not* normalize, so the two dedupe paths in one handler have inconsistent semantics.

**Impact:** scanning the same physical card twice with no email on the card creates two `Contact` rows instead of merging. Silent data duplication; `scripts/dedupeContacts.ts` exists because of this class of problem but only *reports*.

**Fix approach:** introduce one `normalizePhone()` helper and use it on both the write path and the query path, or add normalized shadow columns with indexes and query those.

---

### B2. `gpt-5.6-luna` is not a valid OpenAI model identifier

**Severity:** HIGH

**What's wrong:** the same string appears in two independent call sites:

- `lib/extractCard.ts:81` — `model: "gpt-5.6-luna"`
- `app/api/profile/enrich/route.ts:99` — `model: "gpt-5.6-luna"`

This is not a model in the OpenAI catalog. Both calls also use `max_tokens` against `chat.completions` (`lib/extractCard.ts:83`, `app/api/profile/enrich/route.ts:100`), which the `gpt-5*` family rejects in favour of `max_completion_tokens` on the Responses API.

**Impact:** every scan and every enrichment fails with `model_not_found`. Because the handler wraps errors generically (`app/api/scan/route.ts:469-486`), the user sees a generic failure, not a configuration error — so the misconfiguration is invisible. Verify against the intended provider; if an OpenAI-compatible proxy is in play, make the base URL and model configurable via env rather than hardcoded, and surface upstream error text to logs (not to the client).

---

### B3. `rawNotes` merge compounds unboundedly and permanently corrupts data

**Severity:** HIGH

**What's wrong:** `app/api/scan/route.ts:439-446`:

```ts
if (data.rawNotes && data.rawNotes !== existing.rawNotes) {
  try {
    const merged = { existing: JSON.parse(String(existing.rawNotes || "{}")), incoming: JSON.parse(String(data.rawNotes)) };
    fieldsToUpdate.rawNotes = JSON.stringify(merged);
  } catch { ... }
}
```

Each re-scan nests one level deeper (`{existing:{existing:{existing:{incoming:…}}}}`). There is no depth cap, no size cap, and `rawNotes` is an unindexed `TEXT` column (`prisma/schema.prisma:33`) read and rewritten in full on every scan. The first parse fails on any non-JSON `rawNotes`, silently dropping the branch into `fieldsToUpdate.rawNotes = data.rawNotes` — an unconditional overwrite that loses the prior value.

**Impact:** after N scans of one contact, `rawNotes` is N-deep JSON; parsing cost grows per write; the fallback path discards history with no record.

**Fix approach:** keep `rawNotes` as a flat append-only list with a hard cap (e.g. last 10 entries), or move it to a separate `ScanObservation` table keyed by `contactId`.

---

### B4. Password policy is inconsistent and trivially weak on the reset path

**Severity:** HIGH

**What's wrong:** three different rules:

| Location | Rule | bcrypt cost |
|----------|------|-------------|
| `app/api/auth/register/route.ts:22` | `>= 8` | 12 (`app/api/auth/register/route.ts:50`) |
| `app/api/auth/reset-password/route.ts:20` | `>= 6` | 10 (`app/api/auth/reset-password/route.ts:66`) |
| `app/api/auth/force-reset/route.ts:35` | `>= 8` | 10 (`app/api/auth/force-reset/route.ts:67`) |

No maximum length anywhere. `bcrypt` silently truncates at 72 bytes, so a long passphrase offers no extra protection. No email-format validation on register (`app/api/auth/register/route.ts:12` only checks presence).

**Impact:** accounts created through the reset flow satisfy a weaker policy than the register flow. A password-reset attacker's chosen password is checked against 6 characters.

**Fix approach:** a single shared validator (length 8–128, check against a small breached list) used by all endpoints; equal bcrypt cost; reject pre-hashed-looking input (`$2`) to prevent pass-the-hash.

---

### B5. Location resolution can be poisoned permanently through unauthenticated writes

**Severity:** HIGH

**What's wrong:** `app/api/locations/resolve/route.ts:50-65` upserts into `LocationCache` with `resolved: true` even when the lookup returned nothing. The intent is documented as negative caching (`app/api/locations/resolve/route.ts:50`), but combined with C5 it means:

```bash
curl -X POST /api/locations/resolve -d '{"location":"Pune"}'

# -> attacker floods a query with a typo / a partial address

# -> resolveLocationCoords returns null -> stored resolved:true, lat/lng NULL

# -> every later legit query for that exact string short-circuits at
#    app/api/locations/resolve/route.ts:26 and returns null forever
```

`app/api/locations/route.ts:28` also returns a cache hit purely on existence, ignoring the `resolved` flag — inconsistent with `resolve/route.ts:26`.

**Impact:** permanent, unrecoverable-without-manual-SQL degradation of map pins; unbounded growth of attacker-controlled rows in a `@unique` text column.

**Fix approach:** require auth on these routes; only write `resolved: true` on an actual hit (add `resolved: false` rows for misses with a TTL/`retryAfter`); add a length cap and a query-shape allowlist before persisting.

---

### B6. Global 1.1s geocode throttle serialises the entire Node process

**Severity:** HIGH

**What's wrong:** `lib/location.ts` holds the pacing state in **module-level variables**:

```ts
const GEOCODE_CACHE = new Map<string, [number, number] | null>();
let lastGeocodeAt = 0;
// ...
const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
if (wait > 0) await new Promise((r) => setTimeout(r, wait));
lastGeocodeAt = Date.now();
```

`app/api/locations/batch/route.ts:54-90` loops this serially over an attacker-supplied array with no cap. Because the 1.1s sleep is inside a single shared module instance, **every** concurrent request that needs a Nominatim fallback queues behind it. 50 uncached queries ≈ 55 seconds of blocked event-loop work; two concurrent callers ≈ 110s.

`GEOCODE_CACHE` is also an unbounded `Map` with no eviction and no size cap.

**Impact:** a single unauthenticated `POST /api/locations/batch` with a few hundred distinct strings stalls geocoding for every user. Long-term memory growth from unique attacker-supplied keys.

**Fix approach:** cap `body.locations.length`; move pacing to a shared queue with bounded concurrency; bound `GEOCODE_CACHE` (LRU or rely solely on the DB `LocationCache`); make the throttle per-provider rather than per-process.

---

### B7. LLM-supplied URLs are rendered into `href` and `<img src>` without validation

**Severity:** HIGH

**What's wrong:** `components/ProfileSlideOver.tsx` and `components/ProfileRichText.tsx` render model output directly. `app/api/profile/enrich/route.ts:49-56` (`safeString`) accepts **any** string as a URL; it trims and returns, with no scheme or host validation.

**Impact:** a `javascript:` value (from a hallucination, a poisoned enrichment row, or a crafted card image the model reads as data) yields stored XSS. On the pinned React 18.3.1 (`package.json:28`) `javascript:` hrefs still render with only a dev warning. Arbitrary remote `<img src>` additionally leaks viewer IP/UA to a third-party host.

**Fix approach:** an `isSafeHttpUrl()` guard applied at the API boundary (`app/api/profile/enrich/route.ts`) and again before render; allowlist hosts (`linkedin.com`, `*.cdn.*`) for avatars; serve avatars through `next/image` with `images.remotePatterns` (`next.config.ts` currently defines none).

---

### B8. No HTTP security headers

**Severity:** HIGH

**What's wrong:** `next.config.ts:3-15` defines only `experimental.serverActions`, `allowedDevOrigins`, and `eslint`. There is no `headers()` function and no `images` config. Missing: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

The one header that does exist is applied inconsistently — `app/api/health/route.ts:3` sets `Access-Control-Allow-Origin: *` on a route that also exposes `process.uptime()`.

**Impact:** no defence-in-depth against the B7 XSS vector or any future injection; clickjacking on the slide-over UI; `next/image` with a DB-supplied `session.user.image` (`components/Navbar.tsx`) will throw at runtime because no `remotePatterns` are configured.

**Fix approach:** add a `headers()` block in `next.config.ts` with a CSP that disallows `unsafe-inline` in `script-src`, plus `nosniff`/`DENY`/`frame-ancestors 'none'`. Add `images.remotePatterns` for the known avatar hosts.

---

### B9. `/dashboard` and `/admin` are placeholder shells wired to non-existent routes

**Severity:** HIGH

**What's wrong:** `app/dashboard/page.tsx` renders placeholder stats and quick-action links pointing at `/profile` and `/cards/new` — neither route exists. `app/admin/page.tsx` is the same pattern with eight module links pointing to routes that do not exist: `/admin/users`, `/admin/companies`, `/admin/analytics`, `/admin/roles`, `/admin/settings`, `/admin/database`, `/admin/reports`. `app/directory/page.tsx` renders hardcoded `sampleContacts` and never queries the database.

**Impact:** three of the five top-level pages are non-functional mockups. `/admin` is a real route guarded by `middleware.ts`, so it renders an admin console that leads to seven 404s. Users can be shown fabricated data and believe it.

**Fix approach:** either delete these pages and collapse navigation to the working `/` route, or implement them against real queries. Remove the fake stats and the sample contacts before they reach a demo.

---

### B10. No audit trail for privileged actions

**Severity:** HIGH

**What's wrong:** there is no logging of who scanned, enriched, exported, or reset a password. `app/api/scan/route.ts` never reads the session (C5), so a contact row has no provenance. `app/api/auth/reset-password/route.ts:69-83` changes an account credential with no record. `app/actions/profile-collection.ts:29-38` logs the email of rejected non-developers but not the contact ID or payload of accepted publishes.

**Impact:** for a system holding third-party PII this is a compliance gap. A malicious DEVELOPER could publish research jobs for all contacts with no audit trail.

**Fix approach:** add a structured audit log (DB table or append-only file) recording `userId`, `action`, `targetId`, `timestamp` for every privileged operation.

---

## MEDIUM

### B11. Unauthenticated enumeration via register's 409 response

**Severity:** MEDIUM — `app/api/auth/register/route.ts:39-47` returns `409 "Email is already registered."`, directly contradicting the deliberate anti-enumeration stance at `app/api/auth/forgot-password/route.ts:39-44`. Combined with no rate limit (C3), a single script enumerates the entire user table. Fix: return `201` with a generic success message and send a "someone tried to register with your email" notice.

---

### B12. Password reset does not invalidate existing sessions

**Severity:** MEDIUM — `app/api/auth/reset-password/route.ts:69-83` updates the password and deletes one token, but session strategy is `jwt` (`lib/auth.ts:8-10`), so **every already-issued JWT cookie remains valid** for its full lifetime. A stolen session survives a password change. Fix: add a `passwordChangedAt` column, compare against `token.iat` in the `jwt` callback, and delete all outstanding `PasswordResetToken` rows for that email on reset.

---

### B13. Multiple valid reset tokens can coexist per account

**Severity:** MEDIUM — `app/api/auth/forgot-password/route.ts:61-68` inserts a new row every call without clearing prior ones. N requests → N live tokens (each valid 1 hour). Fix: `deleteMany({ where: { email } })` before `create`.

---

### B14. Reset tokens stored in plaintext

**Severity:** MEDIUM — `prisma/schema.prisma:120` stores the raw 64-char hex token. Anyone with read access to Postgres (a leaked backup, a SQL-injection elsewhere, an over-broad role) gets directly-usable reset tokens. Fix: store `sha256(token)`; compare hashes on redemption.

---

### B15. `researchAllContacts` publishes one RabbitMQ message per contact, unbounded and sequential

**Severity:** MEDIUM — `app/actions/profile-collection.ts:124-176` does `findMany` over the **entire** `Contact` table with no `take`, then `await`s a publish per row. At 5k contacts that is 5k sequential channel round-trips inside one server action; Next.js server actions have a hard body/timeout ceiling, so the action will abort partway and the UI reports a partial count. Fix: page in batches of ~100 and publish per batch; report total from a `count()`.

---

### B16. PII logged in bulk across the server action and extraction layer

**Severity:** MEDIUM — `app/actions/profile-collection.ts:65-68` logs `JSON.stringify(payload)` (full contact, twice); `lib/extractCard.ts:126-128` dumps the full extracted card; `lib/queue/profileCollection.ts` logs queue metadata. Combined with C2 this is a broad PII-in-stdout problem. Fix: structured logger with a redaction layer for `emails`/`mobileNumbers`/`telephoneNumbers`.

---

### B17. Substring city/country matching produces wrong coordinates

**Severity:** MEDIUM — `lib/location.ts` `matchKnownCountry` matches with `lower.includes(c)`. `COUNTRIES[0]` is `"India"`, so **any** address containing the substring `india` — `Indiana, USA`, `Indianapolis`, `British Indian Ocean Territory` — resolves to country `India`. The same substring strategy means `CITY_COORDS["new york"]` matches `"New York Street, Kolkata"` and pins the contact in New York State, USA; `"Dubai"` matches `"Dubai Camp, Pune"`. Fix: word-boundary or comma-segment-exact matching; make "India" a last-resort default rather than a substring hit.

---

### B18. `OR: undefined` fallback can match an arbitrary contact

**Severity:** MEDIUM — `app/api/scan/route.ts:290` and `app/api/scan/route.ts:381` both pass `OR: orClauses.length ? orClauses : undefined as any`. In practice the earlier validation guarantees a non-empty list, so this does not fire today — but it is a latent trap: if the validation is ever relaxed, `findFirst` with no filter returns the first row in an unspecified order and the handler silently **merges an uploaded card into an unrelated person**. Fix: fail closed with an explicit early return.

---

### B19. Dockerfile port/environment inconsistency

**Severity:** MEDIUM — `Dockerfile:50` sets `ENV PORT=3000`, `Dockerfile:70` declares `EXPOSE 4111`, and `package.json:8` runs `next start --port 4111`. Only `docker-compose.yml:18` (`PORT: 4111`) makes the standalone server actually bind where it is exposed. Remove `ENV PORT=3000` and declare a single port. Also note `Dockerfile:8` sets `PUPPETEER_SKIP_DOWNLOAD=true` but Puppeteer is not a dependency — dead config.

---

### B20. `.dockerignore` excludes only `.env`, not the other env variants

**Severity:** MEDIUM — `.dockerignore` lists `.env`, `node_modules`, `.next`. `Dockerfile:28` then does `COPY . .` into the build stage. `.env.production` (referenced by `docker-compose.yml:13-14`) and `.env.local` are **not** excluded and would be baked into the layer. `next build` reads the build-context `.env` and inlines any `NEXT_PUBLIC_*` values into the client bundle permanently. Fix: `.env*` plus `!.env.example`.

---

### B21. No container healthcheck, so `restart: unless-stopped` cannot detect a wedged process

**Severity:** MEDIUM — neither `Dockerfile` nor `docker-compose.yml` declares a `healthcheck`/`HEALTHCHECK`, even though `/api/health` exists (`app/api/health/route.ts:1-5`). A Next.js process stuck on the geocode throttle (B6) or after an unhandled rejection stays "running" and keeps receiving traffic with 5xx responses. Fix: add a `HEALTHCHECK CMD` against `/api/health` and mark the compose service `depends_on: condition: service_healthy` where it is consumed.

---

### B22. `experimental.serverActions` is the wrong key for Next.js 15

**Severity:** MEDIUM — `next.config.ts:4-8` sets `experimental.serverActions.bodySizeLimit`. In Next.js 15 this moved to the top-level `serverActions` key; under `experimental` it is ignored (with a build warning). The intended 10 MB body cap on `publishProfileCollection` / `researchAllContacts` (`app/actions/profile-collection.ts`) is therefore not in effect. Fix: move to top level, or set `experimental.serverActions` per the version actually pinned in `package-lock.json`.

---

### B23. No build-time env validation

**Severity:** MEDIUM — `NEXTAUTH_SECRET` is read unguarded at `lib/auth.ts:108`; `DATABASE_URL` is asserted with `!` at `lib/prisma.ts`. Neither is validated at boot. A missing `NEXTAUTH_SECRET` makes `withAuth` (`middleware.ts:4`) throw on every request to a matched path, and a missing `DATABASE_URL` surfaces as an opaque adapter error. Add a startup assertion (a small `instrumentation.ts` or an entry check) that fails fast with a named variable.

---

## LOW

### B24. Search filters on `JSON.stringify(contact)` and is not memoized

`app/page.tsx` recomputes `filteredContacts` on **every** render, calling `JSON.stringify` per contact per keystroke and re-running `deriveStateCountry` for every contact. At a few thousand contacts, typing in `SearchBar` re-serializes the whole dataset per character. Wrap in `useMemo([contacts, search, filterState, filterCountry])` and precompute the derived `state`/`country` once per contact.

---

### B25. Deduplication is N+1 by construction

`app/api/scan/route.ts:289-291` and `:381-400` issue a `findFirst` then a `create` per row/record. A 5,000-row import is 10,000 sequential round trips. Add a GIN index on the array columns and batch with `createMany` + `skipDuplicates`, or bulk-load candidate keys with a single `findMany({ where: { OR: [...] } })`.

---

### B26. `next-env.d.ts` and `tsconfig.tsbuildinfo` are committed

`next-env.d.ts` is listed in `.gitignore` yet is tracked. `tsconfig.tsbuildinfo` is a build artifact tracked at the repo root and is ~1 MB of absolute-path data; it churns on every compile and merges badly. Run `git rm --cached` on both.

---

### B27. Card scan rejects the whole upload when company is missing

`app/api/scan/route.ts:360-368` returns 400 unless **both** `fullName` and `company` are present. A card with a name but no company — a common case for freelancers — is discarded entirely rather than partially saved. The spreadsheet path uses the same rule (`app/api/scan/route.ts:258-261`). Confirm this is intended; if not, relax to a warning and save with nulls.

---

### B28. `LocationCache` query column is unbounded, attacker-controlled text

`prisma/schema.prisma:131` — `query String @unique` with no length constraint. B5 lets an anonymous caller insert arbitrarily long strings into a unique index. Add a `VARCHAR(n)` / `@db.VarChar(n)` and a length check at the route boundary.

---

### B29. `rawNotes` from the model is stored without sanitisation

`lib/extractCard.ts:166` accepts `parsed.rawNotes` verbatim from the model and `app/api/scan/route.ts:402` writes it to the DB. Whatever the vision model "read" off an attacker-supplied image is persisted and later displayed. Currently rendered through React's escaping, so not directly XSS, but it is untrusted data round-tripping without any normalisation.

---

### B30. Hardcoded LAN origins and a misleading privacy claim

`next.config.ts:9` pins `allowedDevOrigins: ["192.168.1.196", "192.168.1.200", "192.168.0.181"]` — developer-specific IPs in a committed config. `app/page.tsx` renders a UI footer stating **"Runs entirely on your upload — nothing is stored"**, which is false: `app/api/scan/route.ts:385` and `:459` persist every card to Postgres, and `app/api/contacts/route.ts:29` serves the table back. Correct the copy — as written it is a misleading privacy claim.

---

### B31. `/api/health` leaks process uptime to any origin

`app/api/health/route.ts:1-5` returns `process.uptime()` with `Access-Control-Allow-Origin: *`. Low impact on its own, but it gives an attacker a restart/restart-cadence signal and is the only endpoint with a CORS header at all — inconsistent policy. Return `{status:"ok"}` only, and let the container healthcheck read a richer payload over loopback.

---

## Missing Critical Features

### Zero automated tests (partially addressed)

**Severity:** MEDIUM (as a systemic risk — was CRITICAL before Phase 1)

A Vitest harness now exists (`vitest.config.ts`, `tests/` directory with 7 test files, `npm test` script). The suite covers security boundaries, route enumeration, role boundaries, cookie integrity, and CI gate commands. However, the following areas remain untested:

1. `app/api/auth/forgot-password` must **not** return a token in the response (C1 regression).
2. `lib/location.ts` `deriveStateCountry` / `resolveLocationCoords` on `"Indiana, USA"` and `"New York Street, Kolkata"` (B17).
3. `app/api/scan` dedupe: scan the same card twice with only a phone number → one `Contact` row (B1).
4. `components/ProfileSlideOver` poll scheduling.
5. Spreadsheet import: header aliasing, row validation, malformed files.
6. OpenAI call sites: prompt construction, response normalisation, `javascript:` URL rejection.
7. RabbitMQ publishing: channel lifecycle, reconnect, backpressure.

### No key rotation or session revocation mechanism

JWT sessions with `strategy: "jwt"` and no `passwordChangedAt` (B12) mean a compromised session cannot be revoked short of rotating `NEXTAUTH_SECRET`, which logs out every user.

---

## Fragile Areas

**`app/api/scan/route.ts` (487 lines) — the highest-risk file in the repo.**
One handler carries MIME sniffing, size gating, an XLSX parser, a fuzzy header mapper, a dedupe engine, a merge algorithm, `rawNotes` JSON surgery, and RabbitMQ publishing. The two branches (image vs spreadsheet) have **divergent dedupe semantics** (B1 vs `:277-279`) and divergent `await` discipline. Any edit here risks breaking the other branch. Safe modification: extract `parseSpreadsheet()`, `findExistingContact()`, and `mergeContact()` as separately testable pure-ish functions, and drive both branches through one shared dedupe/merge path.

**`lib/location.ts` — ~400 lines of hardcoded geography tables.**
`INDIAN_STATES`, `STATE_ABBREVIATIONS`, `CITY_TO_STATE`, `INTERNATIONAL_CITY_TO_COUNTRY`, and `CITY_COORDS` must be kept in sync manually. `CITY_TO_STATE` and `CITY_COORDS` already disagree on coverage — `CITY_COORDS` omits several entries present in `CITY_TO_STATE`, so a city can resolve a state but fall through to a live Nominatim call. Safe modification: derive `CITY_COORDS` from a single dataset at build time, and add a consistency test asserting key parity.

**The RabbitMQ module-level singleton (`lib/rabbitmq.ts:3-4`).**
`getChannel()` (`:32-53`) has no promise memoization, so N concurrent first-calls create N channels (only the last is retained; the rest leak). Combined with `app/api/scan/route.ts:407` firing a publish on every scan, the channel count grows under concurrency. Safe modification: memoize the in-flight promise.

**The four location endpoints (`app/api/locations/route.ts`, `batch/route.ts`, `resolve/route.ts`, `cache-check/route.ts`).**
Three near-duplicate implementations of normalize → dedupe → cache-lookup → persist, with inconsistent semantics (`app/api/locations/route.ts:28` checks cache *existence*; `app/api/locations/resolve/route.ts:26` checks `existing.resolved`). Any cache-policy change must be applied in three places. Extract one `LocationResolver` service.

---

## Scaling Limits

| Resource | Current capacity | Breaking point | Scaling path |
|----------|------------------|----------------|--------------|
| Contacts list | ~1k comfortable | ~5k — client-side filtering serializes whole dataset per keystroke | Server-side search/filter; indexed full-text search |
| `/api/locations/batch` | ~50 queries/request | ~55 s per request at the 1.1 s serial throttle; blocks all concurrent geocoding (B6) | Concurrent queue with bounded parallelism; cap array length; Redis cache in front of the DB cache |
| `/api/scan` spreadsheet import | ~1k rows | ~5k rows ≈ 10k sequential queries in one 60 s window (B25) | `createMany` batching inside a transaction; background job |
| OpenAI spend | Unbounded | Immediately — no auth (C5), no rate limit (C3) | Auth + per-user quota; queue scans through RabbitMQ instead of calling OpenAI inline |
| `LocationCache` table | Unbounded | Attacker-controlled growth via B5 | Size cap, TTL on `resolved: false`, auth on the writers |
| `researchAllContacts` | ~200 contacts | ~1k — sequential publishes in one server action (B15) | Batch in chunks; move to a queued job |

---

## Dependencies at Risk

| Package | Risk | Impact | Mitigation |
|---------|------|--------|------------|
| `xlsx` ^0.18.5 (`package.json:30`) | The npm `xlsx` package is not published by SheetJS; 0.18.5 is the last community build and carries **known prototype-pollution and ReDoS advisories** with no fix on that registry. | The parser handles fully unauthenticated, unbounded uploads (C4) | Migrate to `exceljs` or `node-xlsx`, or move sheet parsing into an isolated worker with a size/time cap. At minimum, enforce C4's limits. |
| `next-auth` ^4.24.14 (`package.json:25`) | v4 is superseded by Auth.js v5 and no longer receives feature work; the Auth.js project documents v4 as legacy. | Continued security fixes land on a branch this project is not on | Plan a move to `next-auth@5` / Auth.js, or to a maintained alternative. |
| `bcryptjs` ^3.0.3 (`package.json:21`) | Pure-JS and materially slower than native `bcrypt`. At cost 12 with no rate limit (C3), the register endpoint is a CPU-burn DoS amplifier. | Cheap DoS; also the cost-12 (register) vs cost-10 (reset) split (B4) | Keep it, but add rate limiting first; align cost factors to 12 everywhere. |
| `@prisma/client` ^7.8.0 + `@prisma/adapter-pg` (driver adapter) | The generated client output `/lib/generated/prisma` is gitignored, so a fresh clone cannot typecheck without a generate step. `dotenv` is now declared in `package.json:41` (was undeclared). | Build fragility | Run `npx prisma generate` after install; CI already runs it in the verify job. |
| `uuid` — not in `package.json` | Removed. The codebase uses `crypto.randomUUID()` (`app/api/scan/route.ts:2`, `app/actions/profile-collection.ts:3`). | None | Already addressed. |
| `@auth/prisma-adapter` — not in `package.json` | Removed. Correct, because the JWT session strategy does not use a database adapter. | None | Already addressed. |

---

## Test Coverage Gaps

A Vitest suite exists (`tests/`, 7 files, `npm test`). Coverage is concentrated on security boundaries. The following areas have **no test coverage**:

| Area | What's not tested | Files | Risk | Priority |
|------|-------------------|-------|------|----------|
| Contact dedupe / merge | The `orClauses` query and `fieldsToUpdate` merge logic, both branches | `app/api/scan/route.ts:276-464` | Silent duplicate creation and wrong-record merges (B1, B18) | **High** |
| Location resolution | Substring matching, negative caching, cache poisoning | `lib/location.ts`, `app/api/locations/*` | Wrong map pins, permanent cache corruption (B5, B17) | **High** |
| Spreadsheet import | Header aliasing, row validation, malformed files | `app/api/scan/route.ts:201-328` | DoS and silent data loss (C4, B27) | **High** |
| OpenAI call sites | Prompt construction, response normalisation, `javascript:` URL rejection | `lib/extractCard.ts`, `app/api/profile/enrich/route.ts` | XSS via model output (B7); hardcoded bad model id (B2) | **High** |
| RabbitMQ publishing | Channel lifecycle, reconnect, backpressure | `lib/rabbitmq.ts`, `lib/queue/profileCollection.ts` | Leaked channels, silently dropped jobs | Medium |
| Server actions | Role checks and the unbounded publish loop | `app/actions/profile-collection.ts` | Privilege escalation if the role check is refactored away; server-action timeout (B15) | Medium |
| Client components | Enrichment polling, search filtering at scale | `components/ProfileSlideOver.tsx`, `app/page.tsx` | Silent breakage of the enrichment status UX and UI freeze (B24) | Medium |
| Migrations | Up/down on a populated database | `prisma/migrations/**` | No rollback scripts exist | Low |

---

*Concerns audit: 2026-10-03*
