# cdc-pension-simulator

A French pension simulator for a transition from pay-as-you-go (répartition) to funded (capitalisation) pensions. It is a React + Vite app whose calculations live in `src/simulation-engine.js`.

## Review process

- **Checks** (run before every PR and paste the real output; never claim they pass without running them): `npm run build` (Vite production build, from `package.json`). There are no test or lint scripts yet.
- **Before a PR**: fresh-context subagent review of the diff + `/code-review` + `/security-review`. See `REVIEW.md` for what reviewers must check in this repo.
- **PR body** must have **Testing**, **Risk** (Low/Medium/High + why) and **How to revert** (`.github/pull_request_template.md`).
- **Risk is set by the change, not the author.** High (never auto-merged): auth, secrets, CI/deploy config, economic parameters or calculations, anything hard to undo.
- **Findings**: label Important / Nit / Pre-existing; fix each or resolve it with a written reason. Max 3 review-and-fix rounds, then rethink the approach.
- Patrick is the required human reviewer on every agent-written PR. One concern per PR.
