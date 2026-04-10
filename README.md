This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Sample Input

For testing and demonstration purposes, you can use the provided [sample input file](./samples/sample_input.txt) which contains example email data to simulate inbox scanning functionality.

## Gmail Inbox Connection

The Inbox Scanner now supports direct Gmail connection (OAuth) and server-side scan with:
- deterministic risk/priority scoring
- uncertainty percentage per email
- suggested action + reply draft

### Required environment variables

Add these to `.env.local`:

```bash
OPENAI_API_KEY=your_openai_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/inbox/gmail/callback
```

Optional (enables broader LLM consensus in Inbox Scanner):

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=your_claude_key

# inbox scanner model policy (cost control)
# default behavior uses a single model
INBOX_CONSENSUS_ENABLED=false
# only used when INBOX_CONSENSUS_ENABLED=true
INBOX_CONSENSUS_MAX_MODELS=3
# optional scanner decision policy version label
INBOX_POLICY_VERSION=inbox-policy-v3-phase2
```

Also ensure your Google Cloud OAuth client has:
- Authorized redirect URI: `http://localhost:3000/api/inbox/gmail/callback`
- Gmail API enabled
- Scope allowed: `https://www.googleapis.com/auth/gmail.readonly`

### Flow

1. Open the Inbox Scanner tab.
2. Click `Connect Gmail`.
3. Complete Google consent.
4. Select `Gmail` mode and click `Scan Inbox`.

Inbox consensus controls:
- Scanner defaults to single-model mode (cost saver).
- Admin users can change consensus mode and model count from the Inbox Scanner dashboard.
- Admin changes are persisted server-side and override env defaults for that browser/session context.
- Scanner now applies hybrid classifier + guardrail policy to reduce false high-priority spam/promotions.
- Inbox Scanner includes in-UI feedback actions (`Confirm Spam`, `Confirm Harmful`, `Mark Safe`) that write learning labels to incident memory for future scans.

## Agent Desk LinkUp Depth

Agent Desk defaults LinkUp searches to `standard` depth for cost control.
You can switch to `deep` depth manually from the Agent Dashboard before running.
The selected depth is persisted as a local user preference in the browser.

Planner/runner now supports dynamic LinkUp research count (2-6 searches) based on detected entities.

## Auth + Database (User/Admin)

Authentication now supports:
- User sign up: `/sign-up`
- User sign in: `/sign-in`
- Admin sign in: `/sign-in` with the `Admin` role selected

API routes:
- `POST /api/auth/user/signup`
- `POST /api/auth/user/login`
- `POST /api/auth/admin/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Auth DB provider behavior:
- If `MONGODB_URI` exists, auth uses MongoDB automatically.
- If `MONGODB_URI` is absent, auth uses local file DB at `data/auth/accounts.local.json`.
- You can override with `AUTH_DB_PROVIDER=local|mongo`.

Optional auth env vars:

```bash
AUTH_JWT_SECRET=replace_with_long_random_secret
AUTH_JWT_EXPIRES_IN=7d
AUTH_BCRYPT_ROUNDS=12
AUTH_MONGO_AUTO_SEED=true
```

When Mongo auth auto-seed is enabled, one demo user and one demo admin are seeded from local-auth seed env values on first auth access (disabled by default in production unless explicitly enabled).

If you want an explicit seeded admin identity, set:

```bash
LOCAL_AUTH_ADMIN_NAME=Admin Name
LOCAL_AUTH_ADMIN_EMAIL=admin@example.com
LOCAL_AUTH_ADMIN_PASSWORD=StrongPassword123!
```

## Offline Enforced Mode (No External Model/Web Calls)

To keep mail processing local-only and block external model/web calls, add:

```bash
OFFLINE_MODE=true
OFFLINE_MODE_STATE=enforced
OFFLINE_BLOCK_OUTBOUND=true
OFFLINE_LOCAL_MODELS_ONLY=true
OFFLINE_ALLOW_EXTERNAL_RESEARCH=false
OFFLINE_ALLOW_REMOTE_DRAFTING=false

# optional: show accurate mode in dashboard badge
NEXT_PUBLIC_OFFLINE_MODE=true
NEXT_PUBLIC_OFFLINE_MODE_STATE=enforced
```

Notes:
- In enforced mode, `/api/plan`, `/api/run`, and `/api/agent` are blocked.
- Inbox scanning uses deterministic local policy logic with scam categories + trusted decision output.
- Gmail mode is disabled when outbound blocking is enabled in enforced mode.

## Ticketing + Admin Desk (Peppermint Integration)

Aegis Desk now includes local-first ticketing with optional Peppermint sync:

- Create ticket from Inbox Scanner selected email (`Create Helpdesk Ticket`).
- User self-service dashboard to raise tickets and track own tickets:
  - `/tickets/user`
- Local ticket store + audit trail in `data/tickets/`.
- Sync states: `local_only`, `pending`, `synced`, `failed`.
- Admin Desk to manage status, assignee, notes:
  - `/tickets/admin`
- Ticket list:
  - `/tickets`
- User ticket APIs:
  - `POST /api/tickets/user/create`
  - `GET /api/tickets/user/list?requesterEmail=...`

### Optional Peppermint environment variables

```bash
PEPPERMINT_BASE_URL=http://localhost:5003
PEPPERMINT_AUTH_MODE=login   # login | public
PEPPERMINT_EMAIL=admin@admin.com
PEPPERMINT_PASSWORD=1234

# optional
AEGIS_DATA_DIR=./data
```

If offline mode is enforced with outbound blocked, ticket creation remains local-only and sync is disabled until offline is lifted.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
