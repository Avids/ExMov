import YahooFinance from "yahoo-finance2";
import { getExpectedMove, HttpError } from "../lib/service.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export default async function handler(req, res) {
  try {
    const data = await getExpectedMove(yf, req.query.symbol, 30);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(data);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    const message = e instanceof HttpError ? e.message : "Yahoo Finance request failed. Try again in a moment.";
    if (!(e instanceof HttpError)) console.error(e);
    res.status(status).json({ error: message });
  }
}
