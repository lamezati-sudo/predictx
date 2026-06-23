# PredictX

Gamified prediction trading platform — predict where BTC, ETH, and SOL will be in **15 min**, **1 hour**, or **2 hours**, with **draggable stop-loss and take-profit lines** right on the live chart.

## What makes it different

- **Chart-first UX** — set entry, stop loss, and take profit by dragging horizontal lines (no separate order window)
- **Live candles** — real-time prices from Binance
- **Gamification** — play-money balance, XP, levels, win streaks, and payout multipliers
- **Instant risk view** — see max gain vs max loss before you place a prediction

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) 18+

```bash
cd f:\Trading
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How to play

1. Pick an asset (BTC, ETH, SOL) and a timeframe (5m / 15m / 1h / 1d)
2. Choose **LONG** (price goes up) or **SHORT** (price goes down)
3. **Drag the lines** on the chart:
   - **Blue** = Entry (your prediction price)
   - **Green** = Take profit
   - **Red** = Stop loss
4. Set your stake and hit **Place prediction**
5. Win if price hits take profit or closes in your favor; lose if stop loss hits or you're wrong at expiry

## Tech stack

- Next.js 15 + React 19 + TypeScript
- TradingView Lightweight Charts
- Zustand (persisted game state)
- Tailwind CSS 4
- Binance public API (REST + WebSocket)

## Disclaimer

This is a **demo / play-money** prototype. Not financial advice. Not connected to real money or any exchange order book.
