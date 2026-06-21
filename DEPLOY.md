# Deploy PredictX

Two parts: **Vercel** (website + settlement cron) and **Render** (market worker).

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

> **Cron:** `vercel.json` runs `/api/cron/settle` every minute. Requires Vercel **Pro** for production crons on some plans; Hobby may limit cron. Check your plan.

### CLI alternative

```bash
npx vercel login
npx vercel link
npx vercel env pull
# add env vars in Vercel dashboard, then:
npx vercel deploy --prod
```

---

## 3. Deploy market worker → Render

The worker must run 24/7 (Vercel cannot do this).

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
2. Connect the same GitHub repo.
3. Render reads `render.yaml` and creates **predictx-worker**.
4. Set env vars when prompted:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy. Logs should show:
   ```
   PredictX market worker starting…
   [window] BTC 15m → …
   [flush] 9 ticks persisted
   ```

### Railway alternative

```bash
npm i -g @railway/cli
railway login
railway init
railway variables set NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
railway up --dockerfile Dockerfile.worker
```

---

## 4. Verify production

- [ ] App loads at Vercel URL, login works
- [ ] Graph updates live (worker running)
- [ ] Refresh keeps graph history
- [ ] Place a trade, balance updates
- [ ] Supabase dashboard: ~240 DB req/hour (not 3000+)

---

## Architecture (production)

```
Binance WS ──► Render Worker ──► Realtime Broadcast ──► all users' browsers
                    │
                    └── DB flush every 15s (Supabase)

Users ──► Vercel (Next.js) ──► Supabase (auth, trades, profiles)
Vercel Cron ──► /api/cron/settle ──► settle expired windows
```
