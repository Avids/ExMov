import { expectedMove, localDate } from "./calc.js";

const SYMBOL_RE = /^[A-Z0-9.^=-]{1,15}$/;
const DAY_MS = 86_400_000;
const MAX_EXPIRIES = 15; // keeps Yahoo calls and response time bounded for tickers with daily expiries
const BATCH = 4;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Evenly sample down to `max` items, always keeping the first and last.
export function thin(arr, max) {
  if (arr.length <= max) return arr;
  const idx = new Set();
  for (let i = 0; i < max; i++) idx.add(Math.round((i * (arr.length - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => arr[i]);
}

/** yf: a yahoo-finance2 instance (injected so tests can stub it). */
export async function getExpectedMove(yf, rawSymbol, days = 30) {
  const symbol = String(rawSymbol || "").trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, "Enter a valid ticker symbol, e.g. AAPL.");

  const now = Date.now();
  const [chart, first] = await Promise.all([
    yf.chart(symbol, { period1: new Date(now - 50 * DAY_MS), interval: "1d" }),
    yf.options(symbol, {}),
  ]).catch((e) => {
    if (/not found|no data|delisted/i.test(String(e?.message))) throw new HttpError(404, `No data found for ${symbol}.`);
    throw e;
  });

  const tz = chart.meta?.exchangeTimezoneName;
  const candles = (chart.quotes || [])
    .filter((q) => q.close != null && q.open != null && q.high != null && q.low != null)
    .slice(-20)
    .map((q) => ({ time: localDate(q.date, tz), open: q.open, high: q.high, low: q.low, close: q.close }));
  if (!candles.length) throw new HttpError(404, `No price history for ${symbol}.`);

  const allExp = first.expirationDates || [];
  if (!allExp.length) throw new HttpError(404, `${symbol} has no listed options.`);

  // Expirations from now to now + days (expiry ≈ 21:00 UTC on its date). Fall back to the nearest one.
  const end = now + days * DAY_MS;
  let wanted = allExp.filter((d) => d.getTime() + 21 * 3_600_000 > now && d.getTime() <= end);
  if (!wanted.length) wanted = [allExp[0]];
  wanted = thin(wanted, MAX_EXPIRIES);

  // The first call already returned the nearest chain; fetch the others in small parallel batches.
  const chains = new Map();
  const seed = first.options?.[0];
  if (seed) chains.set(seed.expirationDate.getTime(), seed);
  const todo = wanted.filter((d) => !chains.has(d.getTime()));
  for (let i = 0; i < todo.length; i += BATCH) {
    await Promise.all(
      todo.slice(i, i + BATCH).map(async (d) => {
        try {
          const r = await yf.options(symbol, { date: d });
          if (r.options?.[0]) chains.set(d.getTime(), r.options[0]);
        } catch {
          /* skip this expiry */
        }
      })
    );
  }

  const spot = first.quote?.regularMarketPrice ?? chart.meta?.regularMarketPrice ?? candles.at(-1).close;
  const points = [];
  let skipped = 0;
  for (const d of wanted) {
    const chain = chains.get(d.getTime());
    try {
      if (!chain?.calls?.length || !chain?.puts?.length) throw new Error("empty chain");
      const em = expectedMove({ spot, calls: chain.calls, puts: chain.puts, expirationDate: d, now });
      points.push({ expiry: d.toISOString().slice(0, 10), stale: em.warnings.length > 0, ...em, warnings: undefined });
    } catch {
      skipped++;
    }
  }
  if (!points.length) throw new HttpError(404, `No usable option prices for ${symbol} in the next ${days} days.`);

  const warnings = [];
  if (points.some((p) => p.stale))
    warnings.push("Some ATM options had no bid/ask (market closed?), so last traded prices were used. Those points may be stale.");
  if (skipped) warnings.push(`${skipped} expiration${skipped > 1 ? "s were" : " was"} skipped because of missing option quotes.`);

  return {
    symbol,
    name: first.quote?.shortName || first.quote?.longName || symbol,
    currency: first.quote?.currency || chart.meta?.currency || "USD",
    spot,
    days,
    candles,
    points,
    warnings,
  };
}
