# REVIEW.md — guidance for the AI code reviewer

> Owner: Patrick. Loaded by every automated review of this repo, alongside CLAUDE.md.
> Tune this for a few weeks: whenever a human repeats the same review comment, move it here.

## What failure looks like in this repo
- Nominal and real figures mixed up (a euro amount in 2026 money summed with one in future money), so results look plausible but are wrong.
- Pension indexation uses the wrong base year or the wrong rate (`iota` in `src/simulation-engine.js`), which shifts every later payout silently.
- A return or discount rate (r_c, r_d, existing-debt growth) applied to the wrong years or the wrong cohort, with no error raised.
- Transition cost counted twice: the levy (eqs 30-31) reduces debt and also appears as a cost flow.

## What to check first
1. Correctness of any calculation or economic parameter (units, indexation year, currency, nominal vs real).
2. Security: input validation, secrets in code or logs, injection, unsafe deserialisation, dependency risk (OWASP Top 10).
3. Error handling at system boundaries (user input, external APIs, files).
4. Whether the change matches CLAUDE.md conventions — and whether CLAUDE.md now has stale lines.

## Rules for the reviewer
- **Evidence required.** Every finding cites a file and line and says what input breaks it. No guesses from a name.
- **Label every comment** `Important` (a bug / security issue), `Nit` (style), or `Pre-existing` (not introduced by this PR — never blame the author).
- **Cap nits at 3** per review. Drop style-only findings if there is a real bug to report.
- **Start the summary with a count** ("2 Important, 1 Nit, 0 Pre-existing") and say plainly "Nothing to fix" when clean.
- **Do not repeat** a finding already posted on this PR.
- **After 3 rounds**, stop line-by-line review and ask the author to reconsider the approach.
- **After the first few passes, review only the new diff.**
- When you find a bug, **name the bug class** so the author fixes every instance, not just the one quoted.

## Skip these paths
- `package-lock.json`, `app/package-lock.json`
- `dist/`, `node_modules/`

## Always needs a human (never auto-approve)
- Anything under `.github/workflows/`
- Authentication, payments/billing, secrets handling
- Changes to economic assumptions or parameters (rates, mortality tables, inflation) — a person must confirm the source
- Deployment / release configuration
