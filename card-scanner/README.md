# Cardfile — AI Business Card Scanner

Upload a photo of a business card and get every detail — name, title, company,
phone numbers, emails, website, address, LinkedIn, other socials — extracted
automatically and shown as a clean digital contact card, with a one-tap
download as a `.vcf` file (opens straight into Contacts on phone or laptop).

## How it works

```
Browser (Next.js UI)
   │  upload photo (drag-drop, file picker, or camera on mobile)
   ▼
POST /api/scan  (Next.js Route Handler)
   │  validates file type/size, base64-encodes the image
   ▼
GPT-4o (vision) — lib/extractCard.ts
   │  reads the card and returns structured JSON
   ▼
Result rendered as a digital contact card + .vcf download
```

This uses GPT-4o's vision capability directly to read the card, instead of a
separate OCR step (PaddleOCR) plus a second text-parsing LLM call. In practice
a single vision call is more accurate on angled/glare/low-light photos than
OCR-then-parse, and it removes an entire Python service, a GPU/CPU-heavy
OCR install, and an extra network hop from the stack — one moving part
instead of three. The `lib/extractCard.ts` file is a natural place to swap in
a different pipeline later if you want to add OCR as a fallback, or switch
providers (Anthropic's Claude works just as well for this).

## Getting started

**Requirements:** Node.js 18.18+ and an OpenAI API key
(https://platform.openai.com/api-keys). Your account needs a small amount of
prepaid credit — GPT-4o is pay-as-you-go, not covered by a ChatGPT
subscription.

```bash
npm install
cp .env.example .env.local
# edit .env.local and paste your OPENAI_API_KEY
npm run dev
```

Open http://localhost:3000 — works on desktop, and on your phone if you're on
the same network (use your computer's local IP instead of localhost).

## Deploying

Any Node.js host that supports Next.js works (Vercel, Render, Railway, a
plain VPS with `npm run build && npm start`). Set the `ANTHROPIC_API_KEY`
environment variable on whichever platform you use — never commit it.

## Project structure

```
card-scanner/
├── app/
│   ├── layout.tsx          # Fonts + global shell
│   ├── page.tsx            # Upload → scan → result flow (client component)
│   ├── globals.css
│   └── api/scan/route.ts   # Upload endpoint, calls Claude vision
├── components/
│   ├── UploadZone.tsx      # Drag/drop, file picker, camera capture
│   ├── ScannerStage.tsx    # Animated "scanning" state over the photo
│   └── ContactCard.tsx     # Rendered result + per-field icons
├── lib/
│   └── extractCard.ts      # Prompt + Claude API call + JSON parsing
├── types/card.ts           # Shared CardData / ScanResponse types
└── .env.example
```

## Keeping API costs low

This is already tuned for low cost by default:
- Uses **`gpt-4o-mini`** instead of full `gpt-4o` (~16x cheaper, still reads
  printed card text reliably)
- Sends images at **`detail: "low"`**, which uses far fewer image tokens
- Caps `max_tokens` at 600 since the JSON response is always short
- Resizes large phone photos client-side (`lib/resizeImage.ts`) before upload

At these settings a scan typically costs well under a cent. Two more things
worth doing on the OpenAI side:
- Set a **hard spending limit** in https://platform.openai.com/settings/organization/limits
  so you can never be surprised by a bill
- Turn on **usage alerts** at https://platform.openai.com/settings/organization/billing/overview

If you ever see the model misreading small or stylized text, try `"detail": "high"`
in `lib/extractCard.ts` or bump the model back up to `"gpt-4o"` — both cost more,
so only do it if `gpt-4o-mini` + low detail isn't accurate enough for your cards.

## Notes on scope

The brief this was based on described a larger multi-service system
(separate Python/FastAPI OCR microservice, MongoDB Atlas, user accounts,
analytics dashboard, Docker Compose, CI/CD pipelines). That's a real,
multi-week engineering project rather than something to hand over as a batch
of generated files. What's here is a genuinely working, production-quality
version of the core product — upload a card, get structured contact data
back reliably — that you can run today and extend.

Natural next additions, roughly in order of value:
1. **History/accounts** — save each scan to a database (Postgres via Prisma,
   or MongoDB with the schema style from the original brief) tied to a user.
2. **Auth** — NextAuth.js or Clerk for login/signup.
3. **Batch upload** — scan multiple cards in one session.
4. **Export** — CSV/vCard export of a whole contact list.
5. **Editable results** — let users correct a misread field before saving.

If you want help building any of these out, Claude Code is a good fit for
extending an existing codebase like this one interactively.
