import { NextResponse } from "next/server";
import { z } from "zod";

import { derivCandles } from "@/lib/brokers/deriv";
import { withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { runBacktest } from "@/lib/strategies/backtest";
import { MAX_SCRIPT_LENGTH, ScriptError, checkScript, scriptStrategy } from "@/lib/strategies/script";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  code: z.string().min(1).max(MAX_SCRIPT_LENGTH),
  params: z.record(z.coerce.number()).optional(),
  /** Without these, the script is only checked (syntax, onBar, inputs). */
  data_symbol: z.string().trim().min(1).max(30).optional(),
  timeframe: z.coerce.number().int().positive().optional(),
  bars: z.coerce.number().int().min(300).max(5000).default(3000),
  risk_percent: z.coerce.number().min(0.1).max(5).default(1),
  cost_percent: z.coerce.number().min(0).max(1).default(0.02),
});

export const POST = withUser(async (_user, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;
  const params = { atr_mult: 2, rr: 2, ...input.params };

  let check;
  try {
    check = await checkScript(input.code, params);
  } catch (error) {
    if (error instanceof ScriptError) return jsonError(400, "SCRIPT_ERROR", error.message);
    throw error;
  }
  if (!input.data_symbol || !input.timeframe) {
    return NextResponse.json({ inputs: check.inputs, logs: check.logs });
  }

  let candles;
  try {
    candles = await derivCandles(input.data_symbol, input.timeframe, input.bars);
  } catch (error) {
    return jsonError(502, "MARKET_DATA_UNAVAILABLE", (error as Error).message);
  }
  if (candles.length < 300) return jsonError(422, "NOT_ENOUGH_HISTORY");

  try {
    const def = await scriptStrategy(input.code);
    const result = runBacktest(candles, def, params, {
      initialBalance: 10000,
      riskPercent: input.risk_percent,
      costPercent: input.cost_percent,
      timeframe: input.timeframe,
    });
    return NextResponse.json({
      inputs: check.inputs,
      logs: check.logs,
      range: { from: candles[0]!.epoch, to: candles[candles.length - 1]!.epoch, bars: candles.length },
      ...result,
      trades: result.trades.slice(-200),
    });
  } catch (error) {
    if (error instanceof ScriptError) return jsonError(400, "SCRIPT_ERROR", error.message);
    throw error;
  }
});
