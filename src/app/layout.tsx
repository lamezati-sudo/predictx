import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PredictX — Prediction Trading",
  description: "Predict BTC, ETH & SOL price with built-in stop-loss and take-profit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
