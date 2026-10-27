# ValueBet Tracker & Market Discrepancy Engine

![Status: Active Development](https://img.shields.io/badge/status-active%20development-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-black?logo=next.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Work in Progress](https://img.shields.io/badge/WIP-in%20progress-yellow)

An automated football-odds pipeline that collects bookmaker prices, stores normalized fixtures and odds history, estimates fair probabilities, and surfaces potential positive expected value (+EV) opportunities in a Next.js dashboard.

> **Work in Progress:** This project is under active development. Scraping behavior, supported markets, and analysis features may change.

## Overview

Football odds are published across dynamic bookmaker pages, where prices can be difficult to collect consistently and compare directly. This project automates the pipeline from fixture discovery to market analysis:

1. A Playwright-based scraper reads match and odds data from supported pages.
2. Prisma persists normalized fixtures and timestamped odds records.
3. The analysis layer removes the bookmaker's implied margin (vig) to estimate fair market probabilities.
4. The dashboard presents fixtures, odds, and calculated discrepancies for review.

Comparing raw odds alone can be misleading: a bookmaker's prices include a margin, and prices from different markets or timestamps are not directly comparable. The tracker normalizes outcomes and prices so that market-level comparisons and candidate +EV opportunities can be identified more clearly.

Scraping is subject to each source's terms of service and applicable laws. This project does not guarantee that a source will remain available or that displayed opportunities will be profitable.

## Architecture & Tech Stack

- **Frontend:** Next.js App Router and TypeScript for the dashboard, with modular CSS and shared global theme tokens.
- **Automation layer:** Playwright for browser-based collection from dynamic football-odds pages.
- **Data layer:** Prisma ORM with PostgreSQL or SQLite, storing normalized fixture and historical-odds data.
- **Analysis layer:** TypeScript calculations for implied probabilities, vig removal, fair odds, and expected value.
- **Data flow:** Scrape → normalize → persist → calculate → display.

## Engineering Challenges Solved

### Resilient collection from dynamic pages

Odds pages may render through client-side hydration, update asynchronously, or keep network connections open after the useful content is available. The scraper uses browser automation to observe rendered page state rather than relying only on the initial HTML response. Waiting strategies account for dynamic content and network activity, while selectors and parsing logic translate page data into normalized records. Scraping should remain bounded and observable: source changes, missing data, and navigation failures need to be surfaced rather than treated as successful collections.

### Normalized fixtures and historical prices

Fixtures and odds are different entities with different lifecycles. A normalized relational model keeps fixture identity separate from time-dependent market prices, allowing odds to be recorded as history instead of overwriting previous observations. Prisma provides a typed data-access layer and schema migrations, while PostgreSQL and SQLite support production and local-development workflows. Stable fixture and outcome relationships are essential for comparing prices consistently across collection runs.

### Fair probability and expected value

Decimal odds imply a raw probability of `1 / odds`, but the probabilities for all outcomes in a bookmaker market typically sum to more than 1. The excess is the market overround, commonly called the vig or margin. For a market with `n` outcomes and decimal odds `oᵢ`:

**Raw implied probability**

```text
qᵢ = 1 / oᵢ
```

**Overround**

```text
overround = (Σ qᵢ) - 1
```

**Proportional de-vigged probability**

```text
pᵢ = qᵢ / Σ qⱼ
```

The resulting `pᵢ` values sum to 1 and provide a simple fair-market estimate under proportional margin allocation. The corresponding fair decimal odds are `1 / pᵢ`.

Given an estimated probability `p` and offered decimal odds `o`, expected value per unit staked is:

```text
EV = (p × o) - 1
```

A positive value indicates theoretical positive expected value under that probability estimate; it is not a guarantee of profit. Results depend on data freshness, market comparability, and the assumptions used to estimate probabilities.

## Roadmap

### Completed

- [x] Playwright-based odds scraper
- [x] Prisma schema for fixtures and odds data
- [x] De-vigging and fair-probability calculations
- [x] Dashboard tables for reviewing fixtures and market data

### Upcoming

- [ ] Add a cron-based scheduler for recurring collection
- [ ] Aggregate and compare prices across multiple bookmakers
- [ ] Add webhook alerts for configurable market discrepancies and +EV candidates

## Local Setup

### Prerequisites

- Node.js and npm
- A supported database: PostgreSQL or SQLite
- Playwright-compatible browser dependencies for your operating system

### Install and run

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Install the Playwright browser:**

   ```bash
   npx playwright install chromium
   ```

   Install any additional operating-system dependencies required by Playwright for your platform.

3. **Create your local environment file:**

   macOS/Linux:

   ```bash
   cp .env.example .env
   ```

   Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. **Configure the database connection** in `.env`. Set `DATABASE_URL` to match the provider configured in the Prisma schema. For example, a local SQLite database may use a file URL, while PostgreSQL requires a valid database connection URL. Update any other required environment variables documented in `.env.example`.

5. **Apply the Prisma development migration:**

   ```bash
   npx prisma migrate dev
   ```

6. **Start the Next.js development server:**

   ```bash
   npm run dev
   ```

   Open the local URL printed by Next.js in your browser.

### Bankroll tracker

The bankroll dashboard is available at `/bankroll`. It uses the existing `BetLog`
model while keeping tracker-only entries separate from bets associated with a match.
The initial bankroll is €500, matching the reference bankroll already shown by the
ValueBet dashboard. ROI is net profit divided by total stake.
The year selector scopes dashboard metrics, the monthly chart, and history; the
default year is 2026. The month filter and manual-entry date are kept within the
selected year. The dashboard also summarizes ROI, P&L, win rate, and pending
stakes by normalized bet type for the active year.
Manual entries can be marked pending; pending stakes are shown separately and do
not affect bankroll, profit, ROI, or settled win/loss totals until resolved. Bets
can be resolved as Green, Red, or Void from the history table.

After pulling this feature, update the local database and generated Prisma client:

```bash
npm install
npx prisma db push
npx prisma generate
```

This repository currently has no checked-in Prisma migration history, so `db push`
is used to add the new nullable match relation and tracker fields without resetting
the existing SQLite database. Stop the Next.js development server before running
these Prisma commands on Windows so its loaded query-engine file does not prevent
client regeneration; restart the server afterward. For spreadsheet imports, use `.xlsx` or `.csv` files
with the date in column A, bet type in E, stake in F, and net result in G. The
import endpoint accepts files up to 10 MB and reports skipped rows.

Then start the app with `npm run dev` and open `http://localhost:3000/bankroll`.
Run the import parser checks with `npm run test:bankroll-import`.

### Correcting imported bet dates from 2024

The importer normalizes dates from 2024 (including two-digit `24` dates) to 2026.
To correct records already in the database, back up the database and run this
one-time command from the project directory:

```bash
npm run fix:bankroll-2024-dates
```

The script updates only `BetLog` dates in 2024, preserving each date's month, day,
and UTC time down to milliseconds. It can safely be run again; already corrected
2026 records are left unchanged.

## License

This project is licensed under the MIT License.
