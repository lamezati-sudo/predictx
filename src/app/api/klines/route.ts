import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval") ?? "1m";
  const limit = searchParams.get("limit") ?? "120";

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const startTime = searchParams.get("startTime"); // optional epoch ms
  const qs = `symbol=${symbol}&interval=${interval}&limit=${limit}${startTime ? `&startTime=${startTime}` : ""}`;

  const endpoints = [
    `https://api.binance.us/api/v3/klines?${qs}`,
    `https://api.binance.com/api/v3/klines?${qs}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, {
          headers: { "Cache-Control": "no-store" },
        });
      }
    } catch {
      // try next endpoint
    }
  }

  return NextResponse.json({ error: "All upstream sources failed" }, { status: 502 });
}
