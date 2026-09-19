// Pure helpers: no network, easy to test.

const SQRT_HALF_PI = Math.sqrt(Math.PI / 2); // ≈ 1.2533
const DAY_MS = 86_400_000;

export function mid(o) {
  if (!o) return null;
  const { bid, ask, lastPrice } = o;
  if (bid > 0 && ask > 0) return { price: (bid + ask) / 2, source: "mid" };
  if (lastPrice > 0) return { price: lastPrice, source: "last" };
  return null;
}

// Closest strike to spot that has both a call and a put.
export function pickAtm(calls, puts, spot) {
  const putByStrike = new Map(puts.map((p) => [p.strike, p]));
  let best = null;
  for (const c of calls) {
    const p = putByStrike.get(c.strike);
    if (!p) continue;
    const d = Math.abs(c.strike - spot);
    if (!best || d < best.d) best = { d, call: c, put: p };
  }
  return best && { strike: best.call.strike, call: best.call, put: best.put };
}

/**
 * 1-sigma expected move from the ATM straddle.
 * For a zero-drift normal move, straddle ≈ E|X| = σ·√(2/π), so σ = straddle · √(π/2).
 * Also returns the IV-based figure (spot · IV · √(DTE/365)) as a cross-check.
 */
export function expectedMove({ spot, calls, puts, expirationDate, now = Date.now() }) {
  const atm = pickAtm(calls, puts, spot);
  if (!atm) throw new Error("No strike with both a call and a put.");

  const c = mid(atm.call);
  const p = mid(atm.put);
  if (!c || !p) throw new Error("ATM option has no usable bid/ask or last price.");

  const warnings = [];
  if (c.source === "last" || p.source === "last")
    warnings.push("Bid/ask unavailable for the ATM options (market closed?). Last traded prices were used, so the result may be stale.");

  const straddle = c.price + p.price;
  const move = straddle * SQRT_HALF_PI;

  const ivs = [atm.call.impliedVolatility, atm.put.impliedVolatility].filter((v) => v > 0.01);
  const iv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  // Equity options expire ~4pm ET; approximate as 21:00 UTC on the expiry date.
  const dte = Math.max((new Date(expirationDate).getTime() + 21 * 3_600_000 - now) / DAY_MS, 0);
  const ivMove = iv != null && dte > 0 ? spot * iv * Math.sqrt(dte / 365) : null;

  return {
    atmStrike: atm.strike,
    callPrice: c.price,
    putPrice: p.price,
    straddle,
    move,
    movePct: (move / spot) * 100,
    upper: spot + move,
    lower: spot - move,
    iv,
    dte,
    ivMove,
    warnings,
  };
}

export function localDate(date, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
