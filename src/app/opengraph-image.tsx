import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The picture shown when someone shares a link to binaryTrades (WhatsApp, X, Facebook, Slack…).
export const runtime = "nodejs";
export const alt = "binaryTrades — automated trading with risk control";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const icon = await readFile(join(process.cwd(), "public/icons/icon-512.png"));
  const src = `data:image/png;base64,${icon.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 88px",
          background: "linear-gradient(135deg, #0B120F 0%, #12201A 60%, #1B2E22 100%)",
          color: "#EDE8D8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} width={120} height={120} alt="" style={{ borderRadius: 28 }} />
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>binaryTrades</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 52, fontWeight: 600, color: "#85BB65" }}>Automated trading with risk control</div>
        <div style={{ marginTop: 22, fontSize: 32, color: "#A9B4AC", lineHeight: 1.4, maxWidth: 980 }}>
          Strategy bots, your own scripts and TradingView alerts on Deriv and MetaTrader 5, with Risk Guard limits on every order.
        </div>
        <div style={{ marginTop: "auto", fontSize: 24, color: "#7F8A83" }}>Trading involves risk. You can lose all the money you trade with.</div>
      </div>
    ),
    size,
  );
}
