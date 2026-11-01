# DCN FG Monitoring

Shared dashboard for IWTS transfer PDFs: import, review, save, browse, analyse and export.

## Setup

1. Create `.env.local` from `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
2. In the Supabase SQL editor run `supabase/server-side-records.sql` (adds `document_time`, indexes and the
   `records_page`, `dashboard_stats` and `check_duplicates` functions the app calls). Re-run this script
   after pulling changes that update its database functions.
3. `npm install`, then `npm run dev`.

For GitHub Pages, add the same two values as repository secrets.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm test` | Runs the parser and helper tests (Vitest) |
| `npm run build` | Type-checks and builds to `dist/` |

## Structure

```
src/
  main.ts            auth, routing, wiring
  api.ts             Supabase client and database calls
  parse.ts           PDF text -> rows (pure, tested)
  importRows.ts      review-table helpers: duplicates, ordering (pure, tested)
  grouping.ts        transaction grouping and stacked cells (pure, tested)
  utils.ts           dates, times, formatting (pure, tested)
  constants.ts       headers and item groups
  pdfText.ts         pdf.js reader (loaded only when a PDF is read)
  ui/                one file per page or widget
  polish.css         dark mode, drawer, pagination, mobile cards
supabase/
  server-side-records.sql
```

## Parser tests

`npm test` covers parsing, import validation, API response mapping, CSV output, and shareable record filters.
`src/parse.test.ts` currently uses synthetic text that follows the layout the regexes expect. Add fixtures from
real PDFs (remove confidential data first) so that format changes are caught by `npm test`.
