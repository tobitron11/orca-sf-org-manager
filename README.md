# Salesforce Org Manager for Orca

An [Orca](https://orca.dev) plugin that keeps the Salesforce org you are about to write to in view, so you do not deploy to the wrong one.

- **Status bar:** shows the default org of the focused worktree, coloured by type: `alias · Sandbox` (green), Dev/Demo and Scratch (accent), `alias · PRODUCTION` (red), expired or unknown (amber). A default inherited from the global config is marked `(global)`. Click opens the sidebar panel.
- **Panel:** the project default sits at the top, all other authenticated orgs below. Per org: set default, pin a global default to the project, open in browser, re-login, rename the alias, show the org ID, remove the login, delete (sandbox and scratch only, you type the alias to confirm). Plus add org (browser login) and remove all expired logins.
- Refreshes on enable, on workspace changes and every 60 seconds.

## Requirements

- Orca `>= 1.4.248`
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) on your `PATH`

## Install

```
git clone https://github.com/tobitron11/orca-sf-org-manager
orca plugin dev load ./orca-sf-org-manager                       # prints a fingerprint
orca plugin dev load ./orca-sf-org-manager --approve <fingerprint>
```

The plugin is a `trusted-worker`: it runs `sf` as a child process with your user rights. Read `src/actions.ts` and `src/worker.ts` before approving; they are short.

## Behaviour and safety

- On its own the plugin only runs read-only `sf` commands (`config get`, `org list`, `org display`). Writes happen only when you press a button.
- "Set default" writes the project-local `target-org`, never `--global`.
- Delete is offered only for sandbox and scratch orgs and needs the typed alias. Nothing deletes a production org.
- Actions are refused while the org list could not be read. The status bar then says `unknown` instead of guessing.
- `org display` also prints the access token; the worker drops it and sends only the org ID to the panel.

## Limits

- Org type is inferred from the `sf` flags and the instance host. Developer, trial and demo orgs (`orgfarm`, `trailsignup`, `*.trailblaze`, `*.develop`, `*-dev-ed`) show as Dev/Demo. Any other non-sandbox org shows as PRODUCTION, so an unknown demo host looks loud rather than safe.
- Orca plugins cannot open a popover from the status bar; the click toggles the sidebar.
- Renaming an alias keeps this project's default pointing at the org. Other projects that use the old alias show `unknown` until you pick a new default there.
- The destructive actions (remove login, delete, remove all expired) are covered by unit tests with a mocked `sf`, not by tests against real orgs.

## Development

```
orca plugin test
orca plugin check
```

Idea for later: a hook that warns or blocks `sf project deploy` when the default is production.

## License

MIT
