# Expected move

Enter a ticker, see the last 20 daily candles and the expected-move band implied by ATM option prices (width selectable: straddle, 0.85× straddle, or 1σ) for every expiry in the next 30 days (one chart point per expiry, plus a table). Export the chart as a PNG.

- `api/expected-move.js`: Vercel Node function; pulls prices and the options chain from Yahoo Finance via `yahoo-finance2` (the Node equivalent of yfinance).
- `lib/`: expected-move math and request handling.
- `public/index.html`: the page (TradingView Lightweight Charts, loaded from a CDN).

## Deploy

    npm i -g vercel
    vercel        # preview
    vercel --prod

Or push the folder to GitHub and import it at vercel.com/new. No environment variables or build settings are needed.

## Local

    npm install
    vercel dev    # serves the page and the /api route

    npm test      # math and handler tests (stubbed Yahoo)

Optional: open `/?symbol=AAPL` to load a ticker directly.
