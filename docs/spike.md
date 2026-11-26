# Spike result (2026-11-26)
1. Worker is a Node process: `child_process.execFile('sf', …)` works directly; no terminal scraping needed. `workspace.list` gives each workspace `path` (needs `workspace:read`), so `sf config get target-org --json` runs in the right project dir (returned local value `capstone-final`).
2. `statusBar.update` works (text + tone), verified by `orca plugin shot --status-bar`.
3. Status-bar click: no picker. Use a command with `action: "sidebar.right.toggle"` (declarative).
4. `sf org list --json`: `isSandbox` is false for orgfarm/trailsignup/trailblaze demo & dev orgs (not production!) and null for expired ones. Production must not be inferred from `isSandbox === false` alone. Stderr carries the "update available" warning, stdout is clean JSON.
