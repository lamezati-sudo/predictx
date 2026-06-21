# PredictX — Backend Setup (Supabase + Vercel)

This turns the local demo into a persistent, multi-device platform with user
accounts, a server-authoritative game engine, and realtime sync.
**Balances are play-money** — see the "Real money" note at the bottom.

---

## 1. Create a Supabase project

1. Go to <https://supabase.com> → **New project**. Pick a region close to you.
2. Wait for it to provision (~2 min).
3. **Project Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** secret → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 2. Run the database schema

1. In Supabase: **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Click **Run**. This creates the `profiles`, `windows`, `predictions`
   tables, RLS policies, the auto-profile trigger, the `place_prediction` /
   `settle_prediction` RPCs, and enables realtime.

## 3. Configure auth

1. **Authentication → Providers → Email**: enable it.
2. For quick local testing, **Authentication → Providers → Email →**
   turn **OFF "Confirm email"** so signups log in instantly. (Turn it back on
   for production.)
3. **Authentication → URL Configuration → Site URL**: set
   `http://localhost:3000` (and add your Vercel URL later).

## 4. Local environment

```bash
cp .env.local.example .env.local
```

Fill in the four values from steps 1 + a random `CRON_SECRET`
(`openssl rand -hex 32`). Then:

```bash
npm install
npm run dev:all
```

`dev:all` starts **two processes**:
- **web** — Next.js app at <http://localhost:3000>
- **worker** — single market-data process (Binance → Realtime Broadcast → DB every 15s)

You can also run them in separate terminals: `npm run dev` and `npm run worker`.

> **Important:** the graph will not update live unless the **worker** is running.
> Browsers only *listen* now — they no longer write to the database every second.

Open <http://localhost:3000> → you'll be redirected to `/login`. Create an
account and you're in with a $10,000 play-money balance that now persists in
the database and syncs across every device you log in from.

## 5. Deploy to Vercel (web app + settlement cron)

1. Push the repo to GitHub and import it at <https://vercel.com>.
2. Add the same env vars in **Project → Settings → Environment Variables**
   (set `NEXT_PUBLIC_SITE_URL` to your Vercel domain).
3. `vercel.json` already schedules `/api/cron/settle` every minute. Vercel
   sends the `CRON_SECRET` automatically via the `Authorization` header.
4. After deploy, add your Vercel domain to Supabase **Auth → URL Configuration**
   and **redirect URLs**.

> The cron settles windows the instant they expire even when no browser is
> open, so balances are always correct on every device.

## 6. Deploy the market worker (production)

Vercel cannot run a 24/7 WebSocket sampler. Deploy `worker/market-worker.ts`
to any always-on host (pick one):

| Host | Cost | Command |
|---|---|---|
| [Railway](https://railway.app) | ~$5/mo | `npm run worker` |
| [Render](https://render.com) background worker | free tier available | same |
| Any VPS | ~$5/mo | `npm run worker` |

Set the same env vars (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
One worker serves **all users** — add more workers only if you need redundancy.

### Request budget (1 worker, any number of users)

| Before (per browser) | After (one worker) |
|---|---|
| ~3,000 REST+Auth+DB / hour / user | ~240 DB writes / hour total |
| Realtime: unused | Realtime Broadcast: live graph |

---

## How server-authority works (anti-cheat)

- **Target price** (previous candle close) is fetched **once on the server**
  when a window is first created, then stored. Every device reads the same
  number — no client can fake its own benchmark.
- **Placing a bet** goes through `/api/predictions` → the `place_prediction`
  RPC debits the balance atomically (row-locked, no double-spend).
- **Early TP/SL exit** goes through `/api/predictions/exit` → the server
  re-fetches the live price, recomputes the probability, and only allows the
  exit if the trigger condition is genuinely met.
- **Settlement** (`/api/cron/settle`) runs server-side, fetches the real close
  price, and credits winnings via `settle_prediction`.

The browser can *request* actions but never directly writes a balance.

---

## Real money — important

This build is **play-money only**. Accepting real deposits (crypto wallet or
bank) for price-prediction trading is a **regulated activity**:

- US price-prediction/event contracts fall under the **CFTC** (this is what
  Kalshi is registered as). Running one unregistered is illegal.
- Taking crypto/fiat deposits generally makes you a **money transmitter**
  (FinCEN MSB + state licenses) and requires **KYC/AML**.
- Payment processors (Stripe, banks) will not onboard an unlicensed
  trading/gambling product.

Adding real money requires a licensed entity or regulated partner + a
KYC/payments provider + legal counsel — it's a business step, not just code.
The infrastructure here is the correct foundation to build that on later.
