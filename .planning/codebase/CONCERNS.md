---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
# Codebase Concerns

**Analysis Date:** 2026-09-29

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH     | 12 |
| MEDIUM   | 16 |
| LOW      | 11 |

> Scope: full repo (excluding `node_modules/`, `.next/`, `.git/`).
> `.env` exists at the repo root and is consumed by the app; its values were not read and no secret values appear below.

---

## CRITICAL

### C1. Every data API is fully unauthenticated — full PII dump for anonymous callers

**Severity:** CRITICAL

**What's wrong:** `middleware.ts:56-63` restricts the matcher to four page routes:

```ts
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/directory/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
```

Middleware therefore never runs for `/api/*`. A repo-wide grep for `getServerSession|requireAuth|isAuthenticated|permissions|authOptions` under `app/api` returns **zero** matches outside `app/api/auth/[...nextauth]/route.ts`. No route handler performs a server-side session or role check.

The consequences are direct and unauthenticated:

| Endpoint | Location | What an anonymous caller gets |
|----------|----------|-------------------------------|
| `GET /api/contacts` | `app/api/contacts/route.ts:4-15` | **Every** contact row + enrichment: names, job titles, companies, all mobile/landline numbers, emails, addresses, LinkedIn URLs |
| `GET /api/profile/[id]` | `app/api/profile/[id]/route.ts:4-23` | Any single contact by cuid (`id` is the only input) |
| `POST /api/scan` | `app/api/scan/route.ts:179` | Billable OpenAI vision calls + write access to the contacts table |
| `POST /api/profile/enrich` | `app/api/profile/enrich/route.ts:84` | Billable OpenAI calls with attacker-supplied prompt payload |
| `POST /api/locations`, `/resolve`, `/batch`, `/cache-check` | `app/api/locations/*/route.ts` | Nominatim quota burn + permanent DB cache writes |

This is amplified by `app/page.tsx`: `/` is not in the matcher, so the *home page renders the entire contact directory UI to anonymous visitors* (`app/page.tsx:66-93` fetches `/api/contacts` on mount, `app/page.tsx:417-530` renders cards/table/map). The `useSession()` check at `app/page.tsx:447` only hides the "View Profile" button — it gates UI, not data.

**Impact:** complete disclosure of the entire business-card database to the internet; unbounded cost exposure on OpenAI and Nominatim; unauthorized data injection into the `Contact` table.

**Fix approach:** add `"/api/:path*"` (or per-route patterns) to the matcher and enforce `requireAuth()`/`requireAdmin()` from `lib/permissions.ts` at the top of every handler. Prefer real server-side guards over `useSession()` in client components. `lib/permissions.ts` already provides `requireAuth()`, `requireAdmin()`, `isAdmin()` — it is simply never called.

---

### C2. Password-reset endpoint returns the live reset token to the caller — account takeover of any user

**Severity:** CRITICAL

**What's wrong:** `app/api/auth/forgot-password/route.ts:36-64`:

```ts
const token = crypto.randomBytes(32).toString("hex");
// ...
const resetLink = `${origin}/reset-password/${token}`;
// TODO:
// Replace this with Nodemailer, Resend, SendGrid, etc.
console.log(resetLink);
// ...
return NextResponse.json({
  success: true,
  message: "Password reset link generated successfully. Check the server console.",
  resetLink,          // <-- token handed back to the caller
});
```

The endpoint correctly avoids email enumeration for unknown addresses (`app/api/auth/forgot-password/route.ts:27-33`), but for any **existing** address it returns a ready-to-use password-reset token in the JSON body.

**Impact:** `POST /api/auth/forgot-password {"email":"admin@company.com"}` returns a token; `POST /api/auth/reset-password {"token":"<that>","password":"anything6plus"}` (`app/api/auth/reset-password/route.ts:6-88`) sets a new password. Full ATO for any account whose email is known — including the `ADMIN` account that gates `middleware.ts:10-17`. No email ownership proof, no rate limit, no logging, no audit trail.

**Fix approach:** delete `resetLink` from the response; ship the token out-of-band via an email provider. Also enforce `>= 8` characters (see B4), hash the token before storage (it is stored in plaintext — `prisma/migrations/20260708062018_add_password_reset/migration.sql:5`), delete all pre-existing tokens for that email on issuance, and rate-limit by IP + email.

---

### C3. No rate limiting anywhere — OpenAI, Nominatim, and auth endpoints are trivially abusable

**Severity:** CRITICAL

**What's wrong:** there is no rate-limiting dependency in `package.json:11-39` and no limiter in `middleware.ts`. Every expensive or security-sensitive handler is wide open:

- `app/api/scan/route.ts:179` — `POST` with `maxDuration = 60` (`app/api/scan/route.ts:38`), one OpenAI vision call per upload, image or spreadsheet, no per-user cap.
- `app/api/profile/enrich/route.ts:84-110` — one `gpt-5.6-luna` completion per call, `max_tokens: 800`.
- `app/api/locations/batch/route.ts:50-86` — loops **serially** over an unbounded `body.locations` array, each miss hitting Nominatim.
- `app/api/auth/register/route.ts:5` — unlimited account creation; every call runs `bcrypt.hash(password, 12)` (`app/api/auth/register/route.ts:50`), a deliberately CPU-expensive op. This is a free CPU-burn DoS.
- `app/api/auth/forgot-password/route.ts:6`, `app/api/auth/reset-password/route.ts:6` — unlimited; enables the C2 chain and offline brute force of reset tokens.

**Impact:** direct, uncapped financial exposure on the OpenAI key; shared-Nomintim blocklist risk (see P4); trivial denial of service via `bcrypt` burn on register.

**Fix approach:** an IP + session-keyed limiter in `middleware.ts` (e.g. an Upstash/Redis or in-process token bucket), applied per route class: tight (5/min) on auth, moderate (30/min) on scan/enrich, low-cost allowance on geocode.

---

### C4. Unauthenticated, unbounded spreadsheet parsing — memory-exhaustion DoS

**Severity:** CRITICAL

**What's wrong:** `app/api/scan/route.ts:196-199` branches to the spreadsheet path *before* the size guard:

```ts
if (!file.type.startsWith("image/") && isSpreadsheet(file)) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
```

The only `MAX_BYTES = 8 * 1024 * 1024` check (`app/api/scan/route.ts:47`) is applied at `app/api/scan/route.ts:341`, **after** the spreadsheet branch has already returned. So CSV/XLSX uploads are effectively unlimited in size.

Worse, the row loop (`app/api/scan/route.ts:226-318`) issues one `prisma.contact.findFirst` plus one `create` **per row, sequentially**, inside a single HTTP request with no row cap. `orClauses` (`app/api/scan/route.ts:272-283`) is also unbounded — a single row with thousands of email cells produces a giant `OR` list in the generated SQL.

**Impact:** a single anonymous multi-hundred-MB upload can OOM the Node process (`NODE_OPTIONS=--max-old-space-size=4096`, `Dockerfile:29`); a 100k-row workbook holds the request open for minutes and hammers Postgres with 200k round trips.

**Fix approach:** move the size/type gate ahead of both branches; cap `file.size` for spreadsheets; cap row count; wrap row processing in a transaction with `createMany`; truncate `orClauses`.

---

### C5. RabbitMQ connection string (with credentials) logged on every publish attempt

**Severity:** CRITICAL

**What's wrong:** `lib/rabbitmq.ts:6-9`:

```ts
async function getModel(): Promise<ChannelModel | null> {
  const url = process.env.RABBITMQ_URL;
  console.log("[RabbitMQ] Connecting to:", url);
```

`RABBITMQ_URL` is an AMQP URI, conventionally `amqp://user:password@host/vhost` — i.e. a plaintext broker credential. It is written to stdout on every channel creation. Docker captures container stdout (`docker-compose.yml:2-23` has no log driver configured), so the credential lands in whatever collects container logs and survives in the log history of every deploy that has ever run.

**Impact:** broker credential disclosure → queue poisoning, message interception (queue payloads carry full contact PII, `lib/queue/profileCollection.ts:5-11`), or job injection.

**Fix approach:** delete the log line (or redact with `new URL(url).host`). Rotate the broker credential. Add a startup assertion that logs only presence, mirroring the pattern already used at `app/api/scan/route.ts:175`.

---

## HIGH

### B1. Phone-number deduplication is silently non-functional in the image path

**Severity:** HIGH

**What's wrong:** `app/api/scan/route.ts:367-374` normalizes phone candidates for the DB query, but the row was written with the *raw* values at `app/api/scan/route.ts:387-388`:

```ts
const mobileCandidates = (data.mobileNumbers ?? []).map((m) => String(m).replace(/[^+0-9]/g, ""));
...
for (const m of mobileCandidates) orClauses.push({ mobileNumbers: { has: m } });
```

Prisma's `has` on a Postgres `String[]` is exact element equality. A card storing `"+91 98765 43210"` will never match a query for `"+919876543210"`. The same mismatch applies to `telCandidates` at `app/api/scan/route.ts:369,374`.

The **spreadsheet** path in the same file (`app/api/scan/route.ts:274-275`) does *not* normalize, so the two dedupe paths in one handler have inconsistent semantics.

The in-memory diff at `app/api/scan/route.ts:413-414` *does* normalize both sides, which masks the problem during merge — the query misses, then the merge logic computes "no new mobiles", so `fieldsToUpdate` stays empty and the caller gets `duplicate_skipped` (`app/api/scan/route.ts:446-453`) for a contact that was never found.

**Impact:** scanning the same physical card twice with no email on the card creates two `Contact` rows instead of merging. Silent data duplication; `scripts/dedupeContacts.ts` exists because of this class of problem but only *reports*.

**Fix approach:** introduce one `normalizePhone()` helper and use it on both the write path and the query path, or add normalized shadow columns with indexes and query those.

---

### B2. `gpt-5.6-luna` is not a valid OpenAI model identifier

**Severity:** HIGH

**What's wrong:** the same string appears in two independent call sites:

- `lib/extractCard.ts:81` — `model: "gpt-5.6-luna"`
- `app/api/profile/enrich/route.ts:95` — `model: "gpt-5.6-luna"`

This is not a model in the OpenAI catalog. Both calls also use `max_tokens` against `chat.completions` (`lib/extractCard.ts:83`, `app/api/profile/enrich/route.ts:96`), which the `gpt-5*` family rejects in favour of `max_completion_tokens` on the Responses API.

**Impact:** every scan and every enrichment fails with `model_not_found`. Because the handler wraps errors generically (`app/api/scan/route.ts:465-481`), the user sees a generic failure, not a configuration error — so the misconfiguration is invisible. Verify against the intended provider; if an OpenAI-compatible proxy is in play, make the base URL and model configurable via env rather than hardcoded, and surface upstream error text to logs (not to the client).

---

### B3. `rawNotes` merge compounds unboundedly and permanently corrupts data

**Severity:** HIGH

**What's wrong:** `app/api/scan/route.ts:435-442`:

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
| login | none | — |

No maximum length anywhere. `bcrypt` silently truncates at 72 bytes, so a long passphrase offers no extra protection. No email-format validation on register (`app/api/auth/register/route.ts:12` only checks presence).

**Impact:** accounts created through the reset flow satisfy a weaker policy than the register flow. A password-reset attacker's chosen password is checked against 6 characters.

**Fix approach:** a single shared validator (length 8–128, check against a small breached list) used by both endpoints; equal bcrypt cost; reject pre-hashed-looking input (`$2`) to prevent pass-the-hash.

---

### B5. Two divergent NextAuth configurations

**Severity:** HIGH

**What's wrong:** the app defines `authOptions` twice, with materially different behaviour:

| | `lib/auth.ts` | `app/api/auth/[...nextauth]/route.ts` |
|---|---|---|
| Email lookup | `where: { email: credentials.email }` (`lib/auth.ts:41`) | `credentials.email.toLowerCase().trim()` (`route.ts:30`) |
| Failure mode | `try/catch` → `console.error` → `return null` (`lib/auth.ts:65-68`) | `throw new Error("User not found")` (`route.ts:34`) |
| Error page | `pages.error = "/login"` (`lib/auth.ts:14`) | not set (`route.ts:13-15`) |
| `image` on user | returned (`lib/auth.ts:62`) | **omitted** (`route.ts:43-50`) |

`lib/auth.ts` is imported by `middleware.ts`, `lib/permissions.ts`, and `app/actions/profile-collection.ts`; `app/api/auth/[...nextauth]/route.ts` is the handler that actually mints sessions.

**Impact:** registration does not normalise email (`app/api/auth/register/route.ts:33-37,54-58`), so `A@x.com` and `a@x.com` are distinct rows, while login always lowercases and can only ever resolve one of them — account confusion / lockout depending on insertion order. The two configs will silently drift further.

**Fix approach:** one `authOptions` in `lib/auth.ts`; `app/api/auth/[...nextauth]/route.ts` becomes `NextAuth(authOptions)`. Normalise email to lowercase+trim on both write and read.

---

### B6. Location resolution can be poisoned permanently through unauthenticated writes

**Severity:** HIGH

**What's wrong:** all four location endpoints upsert into `LocationCache` with `resolved: true` even when the lookup returned nothing (`app/api/locations/route.ts:44-57`, `app/api/locations/resolve/route.ts:50-63`, `app/api/locations/batch/route.ts:69-82`). The intent is documented as negative caching (`app/api/locations/resolve/route.ts:48`), but combined with C1 it means:

```bash
curl -X POST /api/locations -d '{"location":"Pune"}'

# -> attacker floods a query with a typo / a partial address

# -> resolveLocationCoords returns null -> stored resolved:true, lat/lng NULL

# -> every later legit query for that exact string short-circuits at

#    app/api/locations/resolve/route.ts:24 and returns null forever

```

`app/api/locations/route.ts:20-31` also returns a cache hit purely on existence, ignoring the `resolved` flag — inconsistent with `resolve/route.ts:24`.

**Impact:** permanent, unrecoverable-without-manual-SQL degradation of map pins; unbounded growth of attacker-controlled rows in a `@unique` text column.

**Fix approach:** require auth on these routes; only write `resolved: true` on an actual hit (add `resolved: false` rows for misses with a TTL/`retryAfter`); add a length cap and a query-shape allowlist before persisting.

---

### B7. Global 1.1 s geocode throttle serialises the entire Node process

**Severity:** HIGH

**What's wrong:** `lib/location.ts:432-444` holds the pacing state in **module-level variables**:

```ts
const GEOCODE_CACHE = new Map<string, [number, number] | null>();
let lastGeocodeAt = 0;
...
const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
if (wait > 0) await new Promise((r) => setTimeout(r, wait));
lastGeocodeAt = Date.now();
```

`app/api/locations/batch/route.ts:50-86` loops this serially over an attacker-supplied array with no cap. Because the 1.1 s sleep is inside a single shared module instance, **every** concurrent request that needs a Nominatim fallback queues behind it. 50 uncached queries ≈ 55 seconds of blocked event-loop work; two concurrent callers ≈ 110 s.

`GEOCODE_CACHE` is also an unbounded `Map` with no eviction and no size cap.

**Impact:** a single unauthenticated `POST /api/locations/batch` with a few hundred distinct strings stalls geocoding for every user. Long-term memory growth from unique attacker-supplied keys.

**Fix approach:** cap `body.locations.length`; move pacing to a shared queue with bounded concurrency; bound `GEOCODE_CACHE` (LRU or rely solely on the DB `LocationCache`); make the throttle per-provider rather than per-process.

---

### B8. LLM-supplied URLs are rendered into `href` and `<img src>` without validation

**Severity:** HIGH

**What's wrong:** `components/ProfileModal.tsx:159`, `:168`, `:197` render model output directly:

```tsx
<a href={profile.officialSite} target="_blank" rel="noreferrer">{...}</a>
<a href={profile.linkedinProfile} ...>{profile.linkedinProfile}</a>
<a href={social.url} ...>{social.label}: ...</a>
```

`components/ProfileSlideOver.tsx:182` renders `<img src={enrichment.avatar_url}>` — an arbitrary string from the `enrichment` table, written by the external worker.

`app/api/profile/enrich/route.ts:48-55` (`safeString`) accepts **any** string as a URL; it trims and returns, with no scheme or host validation.

**Impact:** a `javascript:` value (from a hallucination, a poisoned enrichment row, or a crafted card image the model reads as data) yields stored XSS. On the pinned React 18.3.1 (`package.json:23`) `javascript:` hrefs still render with only a dev warning. Arbitrary remote `<img src>` additionally leaks viewer IP/UA to a third-party host.

**Fix approach:** an `isSafeHttpUrl()` guard applied at the API boundary (`app/api/profile/enrich/route.ts:57-67`) and again before render; allowlist hosts (`linkedin.com`, `*.cdn.*`) for avatars; serve avatars through `next/image` with `images.remotePatterns` (`next.config.ts` currently defines none).

---

### B9. No HTTP security headers

**Severity:** HIGH

**What's wrong:** `next.config.ts:3-11` defines only `experimental.serverActions`, `allowedDevOrigins`, and `output`. There is no `headers()` function and no `images` config. Missing: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

The one header that does exist is applied inconsistently — `app/api/health/route.ts:3` sets `Access-Control-Allow-Origin: *` on a route that also exposes `process.uptime()`.

**Impact:** no defence-in-depth against the B8 XSS vector or any future injection; clickjacking on the slide-over UI (`components/ProfileSlideOver.tsx:163`); `next/image` with a DB-supplied `session.user.image` (`components/Navbar.tsx:87`) will throw at runtime because no `remotePatterns` are configured.

**Fix approach:** add a `headers()` block in `next.config.ts` with a CSP that disallows `unsafe-inline` in `script-src`, plus `nosniff`/`DENY`/`frame-ancestors 'none'`. Add `images.remotePatterns` for the known avatar hosts.

---

### B10. `/dashboard` and `/admin` are placeholder shells wired to non-existent routes

**Severity:** HIGH

**What's wrong:** `app/dashboard/page.tsx:21-46` renders four stat cards whose `value` is the literal string `"0"`; `:208-212` is hardcoded "No business cards scanned yet"; `:235-238` is hardcoded activity. Its quick-action links point at `/profile` and `/cards/new` (`app/dashboard/page.tsx:148-184`) — neither route exists.

`app/admin/page.tsx:24-49` is the same pattern. All eight module links (`app/admin/page.tsx:51-100`) point to routes that do not exist: `/admin/users`, `/admin/companies`, `/admin/analytics`, `/admin/roles`, `/admin/settings`, `/admin/database`, `/admin/reports`. `app/directory/page.tsx:32-55` renders hardcoded `sampleContacts` (John Smith / Microsoft, Emily Johnson / Google) and never queries the database.

**Impact:** three of the five top-level pages are non-functional mockups. `/admin` is a real route guarded by `middleware.ts:10-17`, so it renders an admin console that leads to seven 404s. Users can be shown fabricated data and believe it.

**Fix approach:** either delete these pages and collapse navigation to the working `/` route, or implement them against real queries. Remove the fake stats and the sample contacts before they reach a demo.

---

### B11. Two separate NextAuth handlers with the same secret mint incompatible session shapes

**Severity:** HIGH

**What's wrong:** covered structurally in B5, but the session-shape consequence is separate. `app/api/auth/[...nextauth]/route.ts:43-50` returns a user object **without** `image`, while `lib/auth.ts:58-64` returns it **with** `image`. The JWT callback at `route.ts:56-62` only copies `id` and `role`, so `session.user.image` is never populated by the live handler — yet `components/Navbar.tsx:86` branches on it and `types/next-auth.d.ts` declares it.

**Impact:** `session.user.image` is always `undefined` in production; the avatar fallback always renders. Any future code that trusts the declared type gets a wrong assumption.

**Fix approach:** collapse to a single `authOptions` and keep the declared type in `types/next-auth.d.ts` authoritative.

---

### B12. CI builds and pushes to production with zero verification

**Severity:** HIGH

**What's wrong:** `.github/workflows/deploy.yml` runs only: checkout → buildx → GHCR login → `docker/build-push-action` (`deploy.yml:20-51`). There is **no** lint, no `tsc --noEmit`, no test run, and no `npm audit` before the image is tagged `latest` and pushed. The deploy job (`deploy.yml:53-77`) then runs `docker compose up -d` on a self-hosted Windows runner with no approval gate and no post-deploy verification.

Additionally: `permissions: packages: write` is workflow-wide (`deploy.yml:8-10`) rather than scoped to the build job; no `environment:` is declared on the deploy job; and `docker-compose.yml:7` defaults to `${APP_VERSION:-latest}`, so any manual `docker compose up` outside CI silently rolls forward.

**Impact:** a type error, a broken route, or a vulnerable transitive dependency ships straight to production. Rollback is manual — the workflow prunes to two images (`deploy.yml:68-73`) but never reverts.

**Fix approach:** add `npm run lint`, `npx tsc --noEmit`, and `npm audit --audit-level=high` as gating steps before the build; scope `permissions` per job; set the deploy job `environment: production` for approval protection; fail the deploy if `/api/health` does not return 200.

---

## MEDIUM

### B13. Unauthenticated enumeration via register's 409 response

**Severity:** MEDIUM — `app/api/auth/register/route.ts:39-47` returns `409 "Email is already registered."`, directly contradicting the deliberate anti-enumeration stance at `app/api/auth/forgot-password/route.ts:27-33`. Combined with no rate limit (C3), a single script enumerates the entire user table. Fix: return `201` with a generic success message and send a "someone tried to register with your email" notice.

### B14. Password reset does not invalidate existing sessions

**Severity:** MEDIUM — `app/api/auth/reset-password/route.ts:69-83` updates the password and deletes one token, but session strategy is `jwt` (`lib/auth.ts:8-10`), so **every already-issued JWT cookie remains valid** for its full lifetime. A stolen session survives a password change. Fix: add a `passwordChangedAt` column, compare against `token.iat` in the `jwt` callback, and delete all outstanding `PasswordResetToken` rows for that email on reset.

### B15. Multiple valid reset tokens can coexist per account

**Severity:** MEDIUM — `app/api/auth/forgot-password/route.ts:41-47` inserts a new row every call without clearing prior ones. N requests → N live tokens (each valid 1 hour). Fix: `deleteMany({ where: { email } })` before `create`.

### B16. Reset tokens stored in plaintext

**Severity:** MEDIUM — `prisma/migrations/20260708062018_add_password_reset/migration.sql:5` and `prisma/schema.prisma:110` store the raw 64-char hex token. Anyone with read access to Postgres (a leaked backup, a SQL-injection elsewhere, an over-broad role) gets directly-usable reset tokens. Fix: store `sha256(token)`; compare hashes on redemption.

### B17. Client-side-only role enforcement, and the guards are never mounted

**Severity:** MEDIUM — `components/ProtectedRoute.tsx` and `components/RoleGuard.tsx` implement client-side gating, but a repo-wide grep shows **no page imports either component**. `app/admin/page.tsx:22` relies solely on `useSession()` for display. Server-side enforcement exists only for `/admin` pages (`middleware.ts:10-17`) and the two developer server actions (`app/actions/profile-collection.ts:29,110`). Fix: either mount the guards for UX or delete them; never treat them as the security boundary.

### B18. `researchAllContacts` publishes one RabbitMQ message per contact, unbounded and sequential

**Severity:** MEDIUM — `app/actions/profile-collection.ts:124-176` does `findMany` over the **entire** `Contact` table with no `take`, then `await`s a publish per row. At 5k contacts that is 5k sequential channel round-trips inside one server action; Next.js server actions have a hard body/timeout ceiling, so the action will abort partway and the UI reports a partial count. Fix: page in batches of ~100 and publish per batch; report total from a `count()`.

### B19. ProfileSlideOver's enrichment polling never starts

**Severity:** MEDIUM — `components/ProfileSlideOver.tsx:126-137` calls `fetchProfile()` (async, not awaited) and then calls `poll()` synchronously. `poll()` reads `data` from the effect's closure (`components/ProfileSlideOver.tsx:129`), which is still the pre-fetch value (`null`), so `status` is `undefined` and the `setTimeout` at `components/ProfileSlideOver.tsx:131` is never scheduled. The dependency array is `[open, contactId]` (`components/ProfileSlideOver.tsx:144`), so the effect does not re-run when `data` arrives. Fix: drive the poll off a `useEffect` keyed on `data?.contact?.enrichment?.status`, or poll unconditionally while `open`.

### B20. Floating promise and PII written to logs on every spreadsheet import

**Severity:** MEDIUM — `app/api/scan/route.ts:294` calls `preCacheLocation(...)` **without `await`** (contrast `app/api/scan/route.ts:402,456` in the image path, which do await). Under serverless or an early response the cache write can be abandoned. The line above it, `app/api/scan/route.ts:293`, logs the entire contact object: `console.log(\`[Scan] Created contact from spreadsheet: ${createdContact}\`)`. Fix: `await` the call; log `createdContact.id` only.

### B21. PII logged in bulk across the server action and extraction layer

**Severity:** MEDIUM — `app/actions/profile-collection.ts:59-68` logs `JSON.stringify(payload)` (full contact, twice, including for rejected non-developers at `:30-33`); `lib/extractCard.ts:126-128` dumps the full extracted card; `lib/queue/profileCollection.ts:30-45` logs queue metadata. Combined with C5 this is a broad PII-in-stdout problem. Fix: structured logger with a redaction layer for `emails`/`mobileNumbers`/`telephoneNumbers`.

### B22. Substring city/country matching produces wrong coordinates

**Severity:** MEDIUM — `lib/location.ts:219-227` (`matchKnownCountry`) matches with `lower.includes(c)`. `COUNTRIES[0]` is `"India"` (`lib/location.ts:134`), so **any** address containing the substring `india` — `Indiana, USA`, `Indianapolis`, `British Indian Ocean Territory` — resolves to country `India`. The same substring strategy at `lib/location.ts:424-429` means `CITY_COORDS["new york"]` matches `"New York Street, Kolkata"` and pins the contact in New York State, USA; `"Dubai"` matches `"Dubai Camp, Pune"`. `matchKnownState` (`lib/location.ts:229-237`) has the same flaw. This feeds both the `stateOptions`/`countryOptions` filter dropdowns (`app/page.tsx:95-112`) and the map pins. Fix: word-boundary or comma-segment-exact matching; make "India" a last-resort default (as already partially done at `lib/location.ts:328`) rather than a substring hit.

### B23. `OR: undefined` fallback can match an arbitrary contact

**Severity:** MEDIUM — `app/api/scan/route.ts:286` and `app/api/scan/route.ts:377` both pass `OR: orClauses.length ? orClauses : undefined as any`. In practice the earlier validation (`app/api/scan/route.ts:255-257`, `:356`) guarantees a non-empty list, so this does not fire today — but it is a latent trap: if the validation is ever relaxed, `findFirst` with no filter returns the first row in an unspecified order and the handler silently **merges an uploaded card into an unrelated person**. Fix: fail closed with an explicit early return.

### B24. Dead second header-matching pass in the CSV mapper

**Severity:** MEDIUM — `app/api/scan/route.ts:100-109` repeats the loop from `:88-99` to "allow a header to equal any alias exactly", but `mapHeader(field).includes(normalized)` at `:95` already covers exact equality (`includes` on a normalised alias array). The block is unreachable and its comment implies a capability that does not exist. Fix: delete; if fuzzy matching was intended, implement it explicitly.

### B25. Inconsistent credential handling between login and registration for unknown users

**Severity:** MEDIUM — `lib/auth.ts:45-56` returns a uniform `null` after logging; `app/api/auth/[...nextauth]/route.ts:33-41` throws distinct `"User not found"` / `"Invalid password"` messages. Through the live handler, next-auth surfaces a `CredentialsSignin` error whose message can distinguish the two cases, enabling account enumeration on the login form. Fix: collapse to the single `lib/auth.ts` implementation (see B5).

### B26. Dockerfile port/environment inconsistency

**Severity:** MEDIUM — `Dockerfile:50` sets `ENV PORT=3000`, `Dockerfile:70` declares `EXPOSE 4111`, and `package.json:8` runs `next start --port 4111`. Only `docker-compose.yml:18` (`PORT: 4111`) makes the standalone server actually bind where it is exposed. Remove `ENV PORT=3000` and declare a single port. Also note `Dockerfile:8` sets `PUPPETEER_SKIP_DOWNLOAD=true` but Puppeteer is not a dependency (`package.json:11-39`) — dead config.

### B27. `.dockerignore` excludes only `.env`, not the other env variants

**Severity:** MEDIUM — `.dockerignore:1-3` lists `.env`, `node_modules`, `.next`. `Dockerfile:28` then does `COPY . .` into the build stage. `.env.production` (referenced by `docker-compose.yml:13-14`) and `.env.local` are **not** excluded and would be baked into the layer. `next build` at `Dockerfile:37` reads the build-context `.env` and inlines any `NEXT_PUBLIC_*` values into the client bundle permanently. Fix: `.env*` plus `!.env.example`.

### B28. No container healthcheck, so `restart: unless-stopped` cannot detect a wedged process

**Severity:** MEDIUM — neither `Dockerfile:44-72` nor `docker-compose.yml:2-23` declares a `healthcheck`/`HEALTHCHECK`, even though `/api/health` exists (`app/api/health/route.ts:1-5`). A Next.js process stuck on the geocode throttle (B7) or after an unhandled rejection stays "running" and keeps receiving traffic with 5xx responses. Fix: add a `HEALTHCHECK CMD` against `/api/health` and mark the compose service `depends_on: condition: service_healthy` where it is consumed.

### B29. `experimental.serverActions` is the wrong key for Next.js 15

**Severity:** MEDIUM — `next.config.ts:4-8` sets `experimental.serverActions.bodySizeLimit`. In Next.js 15 this moved to the top-level `serverActions` key; under `experimental` it is ignored (with a build warning). The intended 10 MB body cap on `publishProfileCollection` / `researchAllContacts` (`app/actions/profile-collection.ts`) is therefore not in effect. Fix: move to top level, or set `experimental.serverActions` per the version actually pinned in `package-lock.json`.

### B30. `experimental` key and build-time env validation are both missing guardrails

**Severity:** MEDIUM — `NEXTAUTH_SECRET` is read unguarded at `lib/auth.ts:93` and `app/api/auth/[...nextauth]/route.ts:73`; `DATABASE_URL` is asserted with `!` at `lib/prisma.ts:11`. Neither is validated at boot. A missing `NEXTAUTH_SECRET` makes `withAuth` (`middleware.ts:4`) throw on every request to a matched path, and a missing `DATABASE_URL` surfaces as an opaque adapter error. Add a startup assertion (a small `instrumentation.ts` or an entry check) that fails fast with a named variable.

---

## LOW

### B31. Search filters on `JSON.stringify(contact)` and is not memoized

`app/page.tsx:114-129` recomputes `filteredContacts` on **every** render, calling `JSON.stringify` per contact per keystroke and re-running `deriveStateCountry` for every contact. `stateOptions` is memoized (`:95-112`) but this is not — the memoization was applied to the wrong one. At a few thousand contacts, typing in `SearchBar` re-serializes the whole dataset per character. Wrap in `useMemo([contacts, search, filterState, filterCountry])` and precompute the derived `state`/`country` once per contact.

### B32. Full contact table is fetched and held in browser memory

`/api/contacts` (`app/api/contacts/route.ts:6-13`) has no pagination, no `select`, and no `take`. `app/page.tsx:51` stores the entire set in React state, and `paginatedCards` (`app/page.tsx:142`) slices it client-side — so pagination is cosmetic. Server-side pagination plus server-side search/filter would remove both this and B31.

### B33. Deduplication is N+1 by construction

`app/api/scan/route.ts:285-291` and `:377-400` issue a `findFirst` then a `create` per row/record. A 5,000-row import is 10,000 sequential round trips. Add a GIN index on the array columns and batch with `createMany` + `skipDuplicates`, or bulk-load candidate keys with a single `findMany({ where: { OR: [...] } })`.

### B34. `next-env.d.ts` and `tsconfig.tsbuildinfo` are committed

`next-env.d.ts` is listed in `.gitignore:7` yet is tracked (`git ls-files`). `tsconfig.tsbuildinfo` is a build artifact tracked at the repo root and is ~1 MB of absolute-path data; it churns on every compile and merges badly. Run `git rm --cached` on both.

### B35. `scripts/dedupeContacts.ts` cannot be executed

There is no `dedupe` script in `package.json:5-10` and no `tsx`/`ts-node` in `devDependencies` (`package.json:28-39`), so the script is unreachable. It also loads the whole table into memory (`scripts/dedupeContacts.ts:7`) with no pagination, and its duplicate key (`scripts/dedupeContacts.ts:17`) uses the **raw** first phone number — the same normalisation defect as B1, so it under-reports the duplicates it exists to find.

### B36. Card scan rejects the whole upload when company is missing

`app/api/scan/route.ts:356-364` returns 400 unless **both** `fullName` and `company` are present. A card with a name but no company — a common case for freelancers — is discarded entirely rather than partially saved. The spreadsheet path uses the same rule (`app/api/scan/route.ts:255-257`). Confirm this is intended; if not, relax to a warning and save with nulls.

### B37. `NEXT_PUBLIC_` values are baked at build time with a dummy `DATABASE_URL`

`Dockerfile:31` hardcodes `ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"` for `npx prisma generate` and `npm run build`. Anything that reads `DATABASE_URL` at module scope during build (e.g. `new PrismaPg(...)` at `lib/prisma.ts:10-12`) is evaluated against the dummy — correct for type generation, but it means a genuine build-time misconfiguration cannot be caught. Note this in the build stage comment rather than leaving the "🟢 FIX" markers (`Dockerfile:30,32`) in shipped source.

### B38. `LocationCache` query column is unbounded, attacker-controlled text

`prisma/schema.prisma:119` — `query String @unique` with no length constraint. B6 lets an anonymous caller insert arbitrarily long strings into a unique index. Add a `VARCHAR(n)` / `@db.VarChar(n)` and a length check at the route boundary.

### B39. `rawNotes` from the model is stored without sanitisation

`lib/extractCard.ts:166` accepts `parsed.rawNotes` verbatim from the model and `app/api/scan/route.ts:398` writes it to the DB. Whatever the vision model "read" off an attacker-supplied image is persisted and later displayed. Currently rendered through React's escaping (`components/ProfileModal.tsx:176`), so not directly XSS, but it is untrusted data round-tripping without any normalisation.

### B40. Hardcoded LAN origins and a `console.log` banner-style boundary

`next.config.ts:9` pins `allowedDevOrigins: ["192.168.1.196","192.168.1.200"]` — developer-specific IPs in a committed config. `app/page.tsx:602-604` renders a UI footer stating **"Runs entirely on your upload — nothing is stored"**, which is false: `app/api/scan/route.ts:381` and `:455` persist every card to Postgres, and `app/api/contacts/route.ts:6` serves the whole table back. Correct the copy — as written it is a misleading privacy claim.

### B41. `app/api/health` leaks process uptime to any origin

`app/api/health/route.ts:1-5` returns `process.uptime()` with `Access-Control-Allow-Origin: *`. Low impact on its own, but it gives an attacker a restart/restart-cadence signal and is the only endpoint with a CORS header at all — inconsistent policy. Return `{status:"ok"}` only, and let the container healthcheck read a richer payload over loopback.

---

## Missing Critical Features

### Zero automated tests

**Severity:** CRITICAL (as a systemic risk)

There is **no test framework** in `package.json:11-39` — no Jest, Vitest, Playwright, or Testing Library — and no test config or test file anywhere in the repo (only `tsconfig.tsbuildinfo` matches for `*.test.*` patterns, and that is inside `node_modules`). `npm run lint` (`package.json:9`) points at `next lint`, but there is no `.eslintrc*` or `eslint.config.*` in the repo root, and `next lint` is deprecated in Next.js 15.

Everything above — the two auth configs (B5), the phone-normalisation dedupe (B1), the polling closure bug (B19), the location substring matching (B22) — is exactly the class of defect a handful of tests would have caught. The highest-value first tests, in order:

1. `app/api/auth/forgot-password` must **not** return a token in the response (C2 regression).
2. Every `app/api/**` route handler rejects an unauthenticated request (C1 regression).
3. `lib/location.ts` `deriveStateCountry` / `resolveLocationCoords` on `"Indiana, USA"` and `"New York Street, Kolkata"` (B22).
4. `app/api/scan` dedupe: scan the same card twice with only a phone number → one `Contact` row (B1).
5. `components/ProfileSlideOver` poll scheduling (B19) — needs a DOM test runner.

### No audit trail for privileged actions

There is no logging of who scanned, enriched, exported, or reset a password. `app/api/scan/route.ts` never reads the session (C1), so a contact row has no provenance. `app/api/auth/reset-password/route.ts:69-88` changes an account credential with no record. For a system holding third-party PII this is a compliance gap.

### No key rotation or session revocation mechanism

JWT sessions with `strategy: "jwt"` and no `passwordChangedAt` (B14) mean a compromised session cannot be revoked short of rotating `NEXTAUTH_SECRET`, which logs out every user.

---

## Fragile Areas

**`app/api/scan/route.ts` (483 lines) — the highest-risk file in the repo.**
One handler carries MIME sniffing, size gating, an XLSX parser, a fuzzy header mapper, a dedupe engine, a merge algorithm, `rawNotes` JSON surgery, and RabbitMQ publishing. The two branches (image vs spreadsheet) have **divergent dedupe semantics** (B1 vs `:274-275`) and divergent `await` discipline (`:294` vs `:402`). Any edit here risks breaking the other branch. Safe modification: extract `parseSpreadsheet()`, `findExistingContact()`, and `mergeContact()` as separately testable pure-ish functions, and drive both branches through one shared dedupe/merge path.

**`lib/auth.ts` vs `app/api/auth/[...nextauth]/route.ts`** — two sources of truth for the same object (B5/B11). Safe modification: delete the inline config in the route handler and import from `lib/auth.ts`; verify with a login round-trip plus a session decode of an existing token.

**`lib/location.ts:1-417`** — ~400 lines of hardcoded geography tables that must be kept in sync manually: `INDIAN_STATES` (`:1-35`), `STATE_ABBREVIATIONS` (`:37-57`), `CITY_TO_STATE` (`:59-131`), `INTERNATIONAL_CITY_TO_COUNTRY` (`:157-203`), and `CITY_COORDS` (`:337-417`). Note `CITY_TO_STATE` and `CITY_COORDS` already disagree on coverage — `CITY_COORDS` omits several entries present in `CITY_TO_STATE` (e.g. `kanpur`, `noida` is present but `ghaziabad` is present while `ludhiana`, `jalandhar`, `mysore` are absent from `CITY_COORDS`), so a city can resolve a state but fall through to a live Nominatim call. Safe modification: derive `CITY_COORDS` from a single dataset at build time, and add a consistency test asserting key parity.

**The RabbitMQ module-level singleton (`lib/rabbitmq.ts:3-4`).** `getChannel()` (`:32-53`) has no promise memoization, so N concurrent first-calls create N channels (only the last is retained; the rest leak). Combined with `app/api/scan/route.ts:403` firing a publish on every scan, the channel count grows under concurrency. Safe modification: memoize the in-flight promise.

**`app/api/locations/batch` vs `/resolve` vs `/cache-check`** — three near-duplicate implementations of normalize → dedupe → cache-lookup → persist, with inconsistent semantics (`app/api/locations/route.ts:24` checks cache *existence*; `app/api/locations/resolve/route.ts:24` checks `existing.resolved`). Any cache-policy change must be applied in three places. Extract one `LocationResolver` service.

---

## Scaling Limits

| Resource | Current capacity | Breaking point | Scaling path |
|----------|------------------|----------------|--------------|
| Contacts list | ~1k comfortable | ~5k — B31/B32 make every keystroke serialize the whole dataset; `/api/contacts` transfers the full table | Server-side pagination + `select`; indexed search |
| `/api/locations/batch` | ~50 queries/request | ~55 s per request at the 1.1 s serial throttle; blocks all concurrent geocoding (B7) | Concurrent queue with bounded parallelism; cap array length; Redis cache in front of the DB cache |
| `/api/scan` spreadsheet import | ~1k rows | ~5k rows ≈ 10k sequential queries in one 60 s window (B33) | `createMany` batching inside a transaction; background job |
| OpenAI spend | Unbounded | Immediately — no auth (C1), no rate limit (C3) | Auth + per-user quota; queue scans through RabbitMQ (the queue already exists — `lib/queue/config.ts:2`) instead of calling OpenAI inline at `app/api/scan/route.ts:354` |
| `LocationCache` table | Unbounded | Attacker-controlled growth via B6 | Size cap, TTL on `resolved: false`, auth on the writers |
| `researchAllContacts` | ~200 contacts | ~1k — sequential publishes in one server action (B18) | Batch in chunks; move to a queued job |

---

## Dependencies at Risk

| Package | Risk | Impact | Mitigation |
|---------|------|--------|------------|
| `xlsx` ^0.18.5 (`package.json:26`) | The npm `xlsx` package is not published by SheetJS; 0.18.5 is the last community build and carries **known prototype-pollution and ReDoS advisories** with no fix on that registry. There is no patched alternative in the same name. | The parser handles fully unauthenticated, unbounded uploads (C4) | Migrate to `exceljs` or `node-xlsx`, or move sheet parsing into an isolated worker with a size/time cap. At minimum, enforce C4's limits. |
| `next-auth` ^4.24.14 (`package.json:20`) | v4 is superseded by Auth.js v5 and no longer receives feature work; the Auth.js project documents v4 as legacy. Also the direct cause of the two-config drift (B5). | Continued security fixes land on a branch this project is not on | Plan a move to `next-auth@5` / Auth.js, or to a maintained alternative. Collapse to one config first (B5) so the migration is a single-file change. |
| `next` ^15.5.7 (`package.json:19`) with `next lint` (`package.json:9`) | `next lint` is deprecated in 15.x; no ESLint config exists in the repo, so the lint script is non-functional. | The only advertised quality gate does nothing; CI (B12) runs nothing | Add `eslint.config.mjs` and either migrate to `eslint` directly or drop the script. |
| `bcryptjs` ^3.0.3 (`package.json:16`) | Pure-JS and materially slower than native `bcrypt`. At cost 12 with no rate limit (C3), the register endpoint is a CPU-burn DoS amplifier (C3/B4). | Cheap DoS; also the cost-12 (register) vs cost-10 (reset) split (B4) | Keep it, but add rate limiting first; align cost factors to 12 everywhere. |
| `@prisma/client` ^7.8.0 + `@prisma/adapter-pg` (driver adapter) | The generated client output `/lib/generated/prisma` is gitignored (`.gitignore:8`), so a fresh clone cannot typecheck without a generate step, and `Dockerfile:34` must run `prisma generate` in an image that has `dotenv` available via `prisma.config.ts:3` (`dotenv` is **not** in `package.json` at all). | Build fragility; CI has no generate step (B12) | Add `dotenv` explicitly or drop the import; add `prisma generate` to CI before `tsc`. |
| `uuid` ^14.0.1 (`package.json:25`) | Imported nowhere — the codebase uses `crypto.randomUUID()` (`app/api/scan/route.ts:2`, `app/actions/profile-collection.ts:3`). Dead dependency that still ships in the image. | Minor bundle/install surface | Remove. |
| No test/lint deps | See "Missing Critical Features" | Systemic | Add Vitest + Testing Library + ESLint, and gate CI on them (B12). |

---

## Test Coverage Gaps

Every area below is untested; coverage is 0% across the board because no test runner is configured (see "Missing Critical Features").

| Area | What's not tested | Files | Risk | Priority |
|------|-------------------|-------|------|----------|
| Authentication / authz | Zero tests on session enforcement for any API route | `middleware.ts`, `app/api/**/route.ts`, `lib/permissions.ts` | Anonymous access to all PII and to paid APIs (C1, C2) | **High** |
| Password reset flow | Token issuance, expiry, single-use, session invalidation | `app/api/auth/forgot-password/route.ts`, `app/api/auth/reset-password/route.ts` | Full account takeover (C2), stale-session survival (B14) | **High** |
| Contact dedupe / merge | The `orClauses` query and `fieldsToUpdate` merge logic, both branches | `app/api/scan/route.ts:272-464` | Silent duplicate creation and wrong-record merges (B1, B23) | **High** |
| Location resolution | Substring matching, negative caching, cache poisoning | `lib/location.ts`, `app/api/locations/*` | Wrong map pins, permanent cache corruption (B6, B22) | **High** |
| Spreadsheet import | Header aliasing, row validation, malformed files | `app/api/scan/route.ts:196-328` | DoS and silent data loss (C4, B36) | **High** |
| OpenAI call sites | Prompt construction, response normalisation, `javascript:` URL rejection | `lib/extractCard.ts`, `app/api/profile/enrich/route.ts:48-82` | XSS via model output (B8); hardcoded bad model id (B2) | **High** |
| RabbitMQ publishing | Channel lifecycle, reconnect, backpressure | `lib/rabbitmq.ts`, `lib/queue/profileCollection.ts` | Leaked channels, silently dropped jobs | Medium |
| Server actions | Role checks and the unbounded publish loop | `app/actions/profile-collection.ts` | Privilege escalation if the role check is refactored away; server-action timeout (B18) | Medium |
| Client components | Enrichment polling, search filtering at scale | `components/ProfileSlideOver.tsx`, `app/page.tsx` | Silent breakage of the enrichment status UX (B19) and UI freeze (B31) | Medium |
| Migrations | Up/down on a populated database | `prisma/migrations/**` | `20260810123516_added_cascade` drops a constraint with no `IF EXISTS`; no rollback scripts exist | Low |

---

*Concerns audit: 2026-09-29*
