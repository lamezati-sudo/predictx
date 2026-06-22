# Deploy PredictX

Three parts: **Vercel** (website), **[cron-job.org](https://cron-job.org/en/)** (settlement), **Fly.io** (market worker).

---

## 1. Push to GitHub

```bash
git init
git add .
git commit -m "PredictX: trading platform with Supabase backend"
```

Create a repo under **[lamezati-sudo](https://github.com/lamezati-sudo)** on GitHub, then:

```bash
git remote add origin https://github.com/lamezati-sudo/predictx.git
git branch -M main
git push -u origin main
```

### Option A — GitHub CLI (fastest)

```bash
gh auth login
gh repo create lamezati-sudo/predictx --public --source=. --remote=origin --push
```

### Option B — GitHub website

1. Go to [github.com/new](https://github.com/new) while logged in as **lamezati-sudo**
2. Repository name: **`predictx`**
3. **Private** or Public — your choice
4. Do **not** add README / .gitignore (we already have them)
5. Create repository, then run:

```bash
git remote add origin https://github.com/lamezati-sudo/predictx.git
git branch -M main
git push -u origin main
```

---

## 2. Deploy web app → Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → Import your GitHub repo.
2. Framework: **Next.js** (auto-detected).
3. Add **Environment Variables** (Production + Preview):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://eirszcqeypzdejfdrlbg.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(from Supabase → API → anon)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase → API → service_role)* |
| `CRON_SECRET` | *(same as in your `.env.local`)* |
| `NEXT_PUBLIC_SITE_URL` | `https://YOUR-APP.vercel.app` *(set after first deploy)* |

4. Click **Deploy**.
5. After deploy, copy your Vercel URL and update:
   - `NEXT_PUBLIC_SITE_URL` in Vercel env → redeploy
   - Supabase → **Auth → URL Configuration** → Site URL + Redirect URLs

> **Settlement:** Use [cron-job.org](https://cron-job.org/en/) (free, 1/min) — see section 3 below. Vercel Hobby cannot run minute-level crons.

### CLI alternative

```bash
npx vercel login
npx vercel link
npx vercel env pull
# add env vars in Vercel dashboard, then:
npx vercel deploy --prod
```

---

## 3. Settlement cron → cron-job.org (free)

Vercel Hobby blocks `* * * * *` crons. Use [cron-job.org](https://cron-job.org/en/) instead:

| Field | Value |
|---|---|
| **URL** | `https://predictx-drab.vercel.app/api/cron/settle` |
| **Method** | GET |
| **Schedule** | Every 1 minute |
| **Header** | `Authorization: Bearer <CRON_SECRET>` |

Test run should return `200` with `{"ok":true,...}`.

---

## 4. Deploy market worker → Fly.io (free tier)

The worker must run 24/7 for the live graph (Vercel cannot do this).

### One-time setup

```bash
# Install Fly CLI (Windows PowerShell)
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

fly auth login
fly apps create predictx-worker   # skip if name taken — pick another in fly.toml
```

### Set secrets (from `.env.local`)

```bash
fly secrets set \
  NEXT_PUBLIC_SUPABASE_URL=https://eirszcqeypzdejfdrlbg.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Do **not** set `CRON_SECRET` / `SITE_URL` on Fly — settlement is handled by cron-job.org.

### Deploy

```bash
fly deploy --config fly.toml
fly logs
```

Logs should show:

```
PredictX market worker starting…
CRON_SECRET or SITE_URL missing — expiry settlement disabled
Broadcast 1 Hz · DB flush every 15s
[flush] 9 ticks persisted
```

### Fly.io free tier notes

- `shared-cpu-1x` + 256MB fits the worker on the free allowance.
- App stays running 24/7 (unlike Render free web services).
- Region `iad` (Virginia) is close to Vercel + Binance US.

### Render alternative (paid ~$7/mo)

See `render.yaml` — background workers require Render **Starter** plan.

```bash
# Blueprint: https://dashboard.render.com/blueprint/new?repo=https://github.com/lamezati-sudo/predictx
```

---

## 5. Verify production

- [ ] App loads at Vercel URL, login works
- [ ] Graph updates live (worker running)
- [ ] Refresh keeps graph history
- [ ] Place a trade, balance updates
- [ ] Supabase dashboard: ~240 DB req/hour (not 3000+)

---

## Architecture (production)

```
Binance WS ──► Fly.io Worker ──► Realtime Broadcast ──► all users' browsers
                    │
                    └── DB flush every 15s (Supabase)

Users ──► Vercel (Next.js) ──► Supabase (auth, trades, profiles)
cron-job.org ──► /api/cron/settle (every 1 min) ──► settle expired windows
```
