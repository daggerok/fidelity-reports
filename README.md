# Fidelity Reports

Fidelity reports in the browser: dividends, DRIPs, investments and watchlists from `Portfolio_Positions` CSV exports. The same reports as [scio-examples](https://github.com/daggerok/scio-examples) (`sbt runMain io.github.daggerok.Main`), with no sbt run and no copying of files: the page builds them right after the input changes

## Using the app

- At start the app loads the files of the repo `data/` folder (copied into `dist/data` by the build) and builds every report
- **Input** tab: every input file as a table, one sub tab per file. Preamble, blank lines and the quoted disclaimers at the end are ignored; an all-accounts export is split by account
- **Load files**: the picked CSV files replace the shown ones (the repo data or files loaded before). **Add files** adds to the loaded files (a file with the same name is replaced). The **✕** on a file tab of Input removes that file. A drop on the page loads over the repo data and adds over loaded files. **Repo data** goes back to the `data/` files, and so does a page reload
- **Output** tab: the reports, built in a web worker; a spinner sits on a report tab until its report is ready
  - **Output per: file**: `1`, `2`, ... (one per account, in file name order like scio `Commons.captureInputs`), each with `Dividends`, `DRIPs`, `Investments`, `Watchlist`, plus `All` with the three watchlists over every account (`All`, `All ETFs`, `All Stocks`)
  - **Output per: report**: `Dividends`, `DRIPs`, `Investments`, `Watchlist`, each with `1`, `2`, ...; `Watchlist` has `All`, `All ETFs`, `All Stocks` and one list per account by its scio name (`Max ROTH IRA` -> `Max Roth`)
- Every table: click a header to sort (ascending, descending, off), column type badges (click cycles, Shift+click resets), filters under the headers (same grammar as Stocks: space AND, comma OR, `!` NOT, `?` empty, `>10 <50`, `10..50`, `K M B T`, `=exact ^starts ends$ /regex/`, dates), search, Columns menu, Copy Tickers, Export .csv (reports in the scio output format, the shown rows in the shown order) and Export .txt (tickers)
- Shares (scio-examples #28): Dividends and Investments show the shares held (`Shares`, HALF_UP to 0.001) and, after every dollar gap, the shares to buy to close it (`Nx Diff Shares`, `$N Shares Diff`, CEILING to 0.001 so a buy never falls short); watchlists leave out the blacklist `SPAXX*` and `SGOV`
- Market cap for every ticker: the last column of Dividends, DRIPs and Watchlist; Investments keeps it where scio has it (5th, after Shares). Export .csv of a table includes it, Download all leaves it out of dividends and DRIPs so the files are the scio ones
- The two rows of output tabs sit in one row from 1280 px (accounts left, reports right) and stack centered on smaller screens
- **Download all**: one zip with the folders and file names of scio-examples `target/`: `dividends/1.csv`..`7.csv`, `DRIPs/1.csv`.., `investments/1.csv`.., `watchlist/All.csv` and `All.txt`, `All ETFs`, `All Stocks` and one list per account by name (the full reports, unfiltered)
- A file whose header lacks a column a report needs (renamed by Fidelity, say) does not give an empty report: that report shows `Fidelity header is missing required column(s) for <report>: ...` and its tabs get a ⚠, like the scio job that fails with the same message. Investments needs Symbol, Cost basis total, Current value, Last price, Market cap; Dividends Symbol, Dist. rate (or Dist. yield), Payment frequency, Last price, Cost basis total, Current value; DRIPs Symbol, Current value, Last price, Dist. rate (or Dist. yield), Payment frequency, Ex-date
- DRIPs show the ex-dividend and payment dates only when they are after **Dates after** (today by default, like the Scala job on the day it runs)
- Nothing leaves the browser; only the view and the table settings are kept in localStorage

## Account numbers (before anything goes public)

A full account number never gets into a commit, the repo or the public site:

- `data/` keeps only the last 4 characters: `AB1234567` -> `*****4567` (same length). `bun run sanitize` masks `data/*.csv` in place (or `bun scripts/sanitize-data.ts a.csv b.csv`); only the Account number column changes, the reports stay the same, a second run changes nothing
- Files you load yourself (Load files, drop) stay in your browser and are shown as they are, with your real account numbers: nothing is uploaded, nothing is committed
- `bun run check-data`: exit 1 while a file in `data/` has a full number, or ANY file of the repo (tracked or new) holds something shaped like one (a letter and 8 digits, or 9 digits)
- `bun run build` runs check-data first and `check-dist` last (the same scan over `dist/`): the build fails instead of producing a site with a number
- `bun run check-history`: exit 1 while any commit holds one
- Git hooks in `.githooks/` (set by `bun install` through `prepare`): `pre-commit` works on what is being committed (the index), masks staged `data/*.csv` automatically (index and working copy) and refuses the commit if any staged file still holds an account-like number, so a commit with a number is never created; `pre-push` re-checks the working tree and the whole history as a last guard; CI runs check-data before the tests and the build
- New exports: copy them into `data/` and commit (the pre-commit hook masks them; `bun run sanitize` does it by hand)

## Reports vs scio-examples

`bun run compare` (or `bun scripts/compare-scio.ts <scio-examples dir> [runDate]`) builds the reports from `scio-examples/src/main/resources/input` and compares them with `target/{dividends,DRIPs,investments,watchlist}`. On the 2026-10-16 data with the fixed scio-examples: 41 passed, 0 failed

- Dividends, DRIPs, investments and the per-account watchlists match. Rows with an equal sort key (the same market cap in a watchlist, the same first diff in dividends) have no defined order in Beam, so those files are compared as sets; investments and DRIPs are byte-identical
- `All`, `All ETFs` and `All Stocks` read every file with its own header. The exports differ in columns (`Sleeve name`: 38, 39 or 41 columns); scio-examples used to read the union of the files with ONE header, which shifted Symbol, Market cap and Sector of the other files (tickers lost, stocks in `All ETFs`). That is fixed in scio-examples (`BuildFidelityAccountsWatchlistScioApp.combinedPipeline`); compare with a `target/` built after the fix
- Money math uses `decimal.js` with 34 digits and HALF_EVEN, the MathContext of Scala's `BigDecimal`, so every cent matches

## Development

```bash
bun install -E
bun test               # report math, CSV reading, output tab structure
bun run serve          # http://localhost:1234 (writes data/index.json and copies data/ first)
bun run build          # Parcel build into dist/, with dist/data
bun run compare        # compare with ../scio-examples/target
```

Layout (same shape as Stocks):

- `src/index.html`, `src/index.css`, `src/main.tsx`, `src/favicon.ico`: the page, plain DOM and Tailwind 4 like Stocks
- `src/reports.ts`: the four Scala jobs ported to TypeScript, pure (`bun test` checks it), `src/worker.ts` runs it in the background
- `src/filter-engine.ts`, `src/dropdown.ts`: verbatim copies of the shared ETF and Stocks blocks (column types, filter grammar, Columns menu)
- `data/`: the default input files; `scripts/data-index.ts` writes `data/index.json` before every build and serve
- `scripts/compare-scio.ts`: the check against scio-examples

## License

MIT
