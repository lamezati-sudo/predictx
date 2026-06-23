-- ════════════════════════════════════════════════════════════════════════
--  PredictX — Supabase schema
--  Run this in the Supabase dashboard → SQL Editor → New query → Run.
--  Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- ════════════════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ════════════════════════════════════════════════════════════════════════
--  profiles — one row per auth user; holds the play-money balance & stats
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text,
  balance      numeric(14,2) not null default 10000.00,
  xp           integer       not null default 0,
  streak       integer       not null default 0,
  best_streak  integer       not null default 0,
  total_wins   integer       not null default 0,
  total_losses integer       not null default 0,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

alter table public.profiles enable row level security;

-- Users can read & update only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════════════════
--  windows — server-authoritative trading windows.
--  The target_price (previous candle close) is fixed ONCE on the server so
--  every device & user sees the exact same benchmark. Settlement is also
--  server-side (close_price + status).
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.windows (
  id           uuid primary key default gen_random_uuid(),
  asset        text        not null,              -- 'BTC' | 'ETH' | 'SOL'
  timeframe    text        not null,              -- '5m' | '15m' | '1h' | '1d'
  window_start timestamptz not null,
  window_end   timestamptz not null,
  target_price numeric(18,8) not null,
  close_price  numeric(18,8),                      -- null until settled
  status       text        not null default 'open', -- 'open' | 'settled'
  created_at   timestamptz not null default now(),
  unique (asset, timeframe, window_start)
);

alter table public.windows enable row level security;

-- Anyone authenticated can read windows (shared market data).
drop policy if exists "windows_select_all" on public.windows;
create policy "windows_select_all" on public.windows
  for select using (auth.role() = 'authenticated');

create index if not exists windows_lookup_idx
  on public.windows (asset, timeframe, window_start desc);
create index if not exists windows_open_idx
  on public.windows (status, window_end);

-- ════════════════════════════════════════════════════════════════════════
--  predictions — every bet placed by a user
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.predictions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  window_id    uuid not null references public.windows (id) on delete cascade,
  asset        text not null,
  timeframe    text not null,
  direction    text not null,                      -- 'above' (UP) | 'below' (DOWN)
  entry_price  numeric(18,8) not null,             -- asset price at open
  target_price numeric(18,8) not null,             -- "price to beat"
  tp_price     numeric(18,8),                       -- take-profit price level
  sl_price     numeric(18,8),                       -- stop-loss price level
  entry_prob   numeric(6,5),                        -- legacy (unused, nullable)
  tp_prob      numeric(6,5),                        -- legacy (unused, nullable)
  sl_prob      numeric(6,5),                        -- legacy (unused, nullable)
  tp_qty       integer       not null default 100, -- % of position to close at TP
  sl_qty       integer       not null default 100,
  stake        numeric(14,2) not null,
  status       text not null default 'active',     -- active|won|lost|taken|stopped
  pnl          numeric(14,2),
  exit_price   numeric(18,8),
  exit_prob    numeric(6,5),                        -- legacy (unused, nullable)
  exit_reason  text,                               -- 'tp'|'sl'|'expiry'|'manual'
  opened_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  settled_at   timestamptz
);

alter table public.predictions enable row level security;

-- Users can read only their own predictions.
drop policy if exists "predictions_select_own" on public.predictions;
create policy "predictions_select_own" on public.predictions
  for select using (auth.uid() = user_id);

-- NOTE: inserts / settlement go through the server (service-role key) so the
-- balance can be debited/credited atomically and can't be tampered with.
-- We deliberately do NOT grant client insert/update here.

create index if not exists predictions_user_idx
  on public.predictions (user_id, opened_at desc);
create index if not exists predictions_active_idx
  on public.predictions (status, expires_at);
create index if not exists predictions_window_idx
  on public.predictions (window_id);

-- ════════════════════════════════════════════════════════════════════════
--  place_prediction — atomic RPC: debit balance + insert prediction.
--  Called by the server with the user's id. Raises if balance insufficient.
-- ════════════════════════════════════════════════════════════════════════
drop function if exists public.place_prediction(
  uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, integer, integer, numeric, timestamptz
);

create or replace function public.place_prediction(
  p_user_id      uuid,
  p_window_id    uuid,
  p_asset        text,
  p_timeframe    text,
  p_direction    text,
  p_entry_price  numeric,
  p_target_price numeric,
  p_tp_price     numeric,
  p_sl_price     numeric,
  p_tp_qty       integer,
  p_sl_qty       integer,
  p_stake        numeric,
  p_expires_at   timestamptz
)
returns public.predictions
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_pred    public.predictions;
begin
  -- Lock the profile row to prevent double-spend on concurrent requests
  select balance into v_balance from public.profiles
    where id = p_user_id for update;

  if v_balance is null then
    raise exception 'profile not found';
  end if;
  if p_stake <= 0 then
    raise exception 'invalid stake';
  end if;
  if v_balance < p_stake then
    raise exception 'insufficient balance';
  end if;

  update public.profiles
    set balance = balance - p_stake, updated_at = now()
    where id = p_user_id;

  insert into public.predictions (
    user_id, window_id, asset, timeframe, direction, entry_price, target_price,
    tp_price, sl_price, tp_qty, sl_qty, stake, expires_at
  ) values (
    p_user_id, p_window_id, p_asset, p_timeframe, p_direction, p_entry_price, p_target_price,
    p_tp_price, p_sl_price, p_tp_qty, p_sl_qty, p_stake, p_expires_at
  ) returning * into v_pred;

  return v_pred;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
--  settle_prediction — atomic RPC: mark prediction settled + credit balance
--  and update win/loss/streak stats. Called by the server only.
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.settle_prediction(
  p_prediction_id uuid,
  p_status        text,      -- 'won'|'lost'|'taken'|'stopped'
  p_pnl           numeric,
  p_exit_price    numeric,
  p_exit_prob     numeric,
  p_exit_reason   text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_pred public.predictions;
  v_win  boolean;
begin
  select * into v_pred from public.predictions
    where id = p_prediction_id and status = 'active' for update;
  if v_pred.id is null then
    return; -- already settled or doesn't exist
  end if;

  v_win := p_pnl > 0;

  update public.predictions set
    status = p_status, pnl = p_pnl, exit_price = p_exit_price,
    exit_prob = p_exit_prob, exit_reason = p_exit_reason, settled_at = now()
    where id = p_prediction_id;

  -- Return original stake + pnl to the user
  update public.profiles set
    balance      = balance + v_pred.stake + p_pnl,
    total_wins   = total_wins   + (case when v_win then 1 else 0 end),
    total_losses = total_losses + (case when v_win then 0 else 1 end),
    streak       = case when v_win then streak + 1 else 0 end,
    best_streak  = case when v_win then greatest(best_streak, streak + 1) else best_streak end,
    xp           = xp + (case when v_win then 25 else 0 end),
    updated_at   = now()
    where id = v_pred.user_id;
end;
$$;

-- ── Realtime ────────────────────────────────────────────────────────────
-- Enable realtime on the tables we subscribe to from the client.
-- (If a table is already in the publication this will error harmlessly —
--  ignore "already member of publication" notices.)
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.predictions;
alter publication supabase_realtime add table public.windows;

-- ════════════════════════════════════════════════════════════════════════
--  window_prob_ticks — shared probability time series (all users, all devices)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.window_prob_ticks (
  id         uuid primary key default gen_random_uuid(),
  window_id  uuid not null references public.windows (id) on delete cascade,
  time_sec   bigint not null,
  prob_above numeric(6,5) not null,
  spot_price numeric(18,8) not null,
  created_at timestamptz not null default now(),
  unique (window_id, time_sec)
);

alter table public.window_prob_ticks enable row level security;

drop policy if exists "window_prob_ticks_select_auth" on public.window_prob_ticks;
create policy "window_prob_ticks_select_auth" on public.window_prob_ticks
  for select using (auth.role() = 'authenticated');

create index if not exists window_prob_ticks_window_time_idx
  on public.window_prob_ticks (window_id, time_sec asc);

alter publication supabase_realtime add table public.window_prob_ticks;
