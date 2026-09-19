import assert from "node:assert/strict";
import YahooFinance from "yahoo-finance2";
import { expectedMove, pickAtm, localDate } from "../lib/calc.js";
import { getExpectedMove, HttpError, thin } from "../lib/service.js";

// real library constructs with the options used in the handler
const real = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
assert.equal(typeof real.chart, "function");
assert.equal(typeof real.options, "function");

// --- calc ---
const calls = [{ strike: 95, bid: 6, ask: 6.2 }, { strike: 100, bid: 3, ask: 3.2, impliedVolatility: 0.3 }, { strike: 105, bid: 1, ask: 1.1 }];
const puts  = [{ strike: 95, bid: 1, ask: 1.1 }, { strike: 100, bid: 2.8, ask: 3.0, impliedVolatility: 0.32 }, { strike: 105, bid: 6, ask: 6.2 }];
assert.equal(pickAtm(calls, puts, 100.4).strike, 100);
const r = expectedMove({ spot: 100.4, calls, puts, expirationDate: new Date("2026-09-25T00:00:00Z"), now: Date.parse("2026-09-19T15:00:00Z") });
assert.ok(Math.abs(r.straddle - 6.0) < 1e-9);
assert.ok(Math.abs(r.move - 6.0 * 1.2533) < 0.01);
assert.ok(Math.abs(r.upper - (100.4 + r.move)) < 1e-9 && Math.abs(r.lower - (100.4 - r.move)) < 1e-9);
assert.ok(r.ivMove > 0 && r.warnings.length === 0);
// fallback to last price warns
const r2 = expectedMove({ spot: 100, calls: [{ strike: 100, bid: 0, ask: 0, lastPrice: 3 }], puts: [{ strike: 100, bid: 0, ask: 0, lastPrice: 3 }], expirationDate: new Date("2026-09-25") });
assert.equal(r2.warnings.length, 1);
assert.throws(() => expectedMove({ spot: 100, calls: [], puts: [], expirationDate: new Date() }));
assert.equal(localDate(new Date("2026-09-18T13:30:00Z"), "America/New_York"), "2026-09-18");
assert.equal(localDate(new Date("2026-09-17T23:30:00Z"), "Asia/Tokyo"), "2026-09-18");

// --- service with stubbed yahoo ---
const day = 86_400_000, t0 = Date.now() - 32 * day;
const quotes = Array.from({ length: 30 }, (_, i) => ({ date: new Date(t0 + i * day), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }));
quotes[5].close = null; // dropped
const at = (n) => { const d = new Date(Date.now() + n * day); d.setUTCHours(0, 0, 0, 0); return d; };
const exps = [at(2), at(9), at(16), at(45)];
const seen = [];
const yf = {
  chart: async () => ({ meta: { exchangeTimezoneName: "America/New_York" }, quotes }),
  options: async (_s, o) => {
    const d = o?.date ?? exps[0];
    seen.push(d.getTime());
    const empty = d.getTime() === exps[1].getTime(); // this expiry has no quotes
    return { quote: { regularMarketPrice: 100.4, shortName: "Test Co", currency: "USD" }, expirationDates: exps,
             options: [{ expirationDate: d, calls: empty ? [] : calls, puts: empty ? [] : puts }] };
  },
};
const d = await getExpectedMove(yf, " aapl ");
assert.equal(d.symbol, "AAPL");
assert.equal(d.candles.length, 20);
assert.match(d.candles[0].time, /^\d{4}-\d{2}-\d{2}$/);
assert.deepEqual(d.points.map((p) => p.expiry), [exps[0], exps[2]].map((x) => x.toISOString().slice(0, 10))); // +45d excluded, empty +9d skipped
assert.ok(d.points.every((p) => p.upper > d.spot && p.lower < d.spot));
assert.ok(d.warnings.some((w) => /skipped/.test(w)));
assert.ok(!seen.includes(exps[3].getTime()), "did not fetch expiry beyond horizon");
// thinning keeps first and last
const many = Array.from({ length: 30 }, (_, i) => i);
const th = thin(many, 15);
assert.equal(th.length, 15); assert.equal(th[0], 0); assert.equal(th.at(-1), 29);
// falls back to nearest expiry when none is inside the horizon
const yfFar = { ...yf, options: async (_s, o) => ({ quote: { regularMarketPrice: 100.4 }, expirationDates: [at(60)], options: [{ expirationDate: o?.date ?? at(60), calls, puts }] }) };
assert.equal((await getExpectedMove(yfFar, "AAPL")).points.length, 1);
await assert.rejects(() => getExpectedMove(yf, "bad symbol!"), (e) => e instanceof HttpError && e.status === 400);
const yfNoOpt = { ...yf, options: async () => ({ expirationDates: [], options: [] }) };
await assert.rejects(() => getExpectedMove(yfNoOpt, "AAPL"), (e) => e.status === 404);

// --- handler ---
const { default: handler } = await import("../api/expected-move.js");
const out = {};
const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; } };
await handler({ query: { symbol: "!!" } }, res);
assert.equal(out.status, 400);
console.log("all tests passed");
