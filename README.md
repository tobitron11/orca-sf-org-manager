# Salesforce Org Manager for Orca

An [Orca](https://orca.dev) plugin that shows which Salesforce org the current worktree writes to, and lets you manage your authenticated orgs from the sidebar.

The Salesforce CLI resolves its default org from a project-local config, falls back to a global one, and tells you about neither unless you ask. With several worktrees and a dozen logged-in orgs, that is how a deploy ends up in the wrong place. This plugin keeps the answer on screen.

## Features

- Status bar item with the default org of the focused worktree, coloured by org type. It updates when you switch worktrees.
- A default inherited from the global config is labelled `(global)`, so you can tell it apart from one set for the project.
- Sidebar panel with every authenticated org. The project default is pinned at the top.
- Per org: set as project default, open in the browser, re-login, rename the alias, show the org ID, remove the login, delete (sandbox and scratch orgs only).
- Add an org with a browser login (production, sandbox or custom domain) and remove all expired logins in one step.
- Narrow sidebars work; rows wrap and long values are truncated.

## Panel layout

Aliases and usernames below are made up.

```
Salesforce Orgs                                    [refresh]

| Project default
| acme-uat                                [Sandbox]
| dev@acme.example.uat
| [Open] [Re-login]
| > Manage
==================================================
acme-dev                                  [Sandbox]
dev@acme.example.dev
[Set default] [Open] [Re-login]
> Manage
--------------------------------------------------
trail-demo                               [Dev/Demo]
demo@example.com
[Set default] [Open] [Re-login]
> Manage
```

`Manage` expands to the org ID, an alias field, and the remove and delete actions.

## Status bar

| Text | Meaning |
| --- | --- |
| `acme-uat · Sandbox` (green) | Default is a sandbox. |
| `trail-demo · Dev/Demo` or `Scratch` | Developer, trial, demo or scratch org. |
| `acme · PRODUCTION` (red) | Default is a production org. |
| `acme-uat · Sandbox (global)` | The default comes from `~/.sf/config.json`; this project has none of its own. |
| `No default org` | Neither a local nor a global `target-org` is set. |
| `Org: unknown (...)` | The CLI could not be read, or `target-org` names an org you are not logged in to. Nothing is guessed. |
| `Org: checking…` | A worktree switch is in progress. |

Clicking the item toggles the right sidebar. Orca does not let plugins open a popover from the status bar.

## Requirements

- Orca 1.4.248 or later
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) on your `PATH`
- A local worktree. Remote or unresolved workspaces show `unknown`.

## Installation

```sh
git clone https://github.com/tobitron11/orca-sf-org-manager
orca plugin dev load ./orca-sf-org-manager
```

The first command prints a fingerprint. Load again with it to approve the plugin:

```sh
orca plugin dev load ./orca-sf-org-manager --approve <fingerprint>
```

The plugin runs as a `trusted-worker`, a Node process that starts `sf` with your user rights. The code that builds every command is in [`src/actions.ts`](src/actions.ts) and is short enough to read before you approve.

## How org types are decided

`sf org list` reports `isSandbox: false` for production orgs and for demo and trial orgs alike, so the flag alone cannot tell them apart. The plugin combines the flags with the hostname of the instance URL.

| Type | Rule |
| --- | --- |
| Expired | `connectedStatus` reports an error. Wins over every other type. |
| Scratch | Listed under `scratchOrgs`, or `isScratch`. |
| Sandbox | `isSandbox` is true. |
| Dev/Demo | Host matches `orgfarm-*`, `trailsignup-*` or `storm-*` on `my.salesforce.com`, or ends in `.trailblaze.my.salesforce.com`, `.develop.my.salesforce.com`, or contains `-dev-ed.`. |
| Production | Everything else. |

The fallback is deliberate. An unfamiliar demo host is shown as production, which is loud but harmless. The reverse mistake would hide a real production org behind a calm colour.

## Safety model

- Without a click, the plugin only runs `sf config get`, `sf org list` and `sf org display`.
- Setting a default runs `sf config set target-org` for the project. It never passes `--global`.
- Delete is offered for sandbox and scratch orgs only, and only after you type the alias. A production org cannot be deleted from here.
- Remove login (`sf org logout`) and delete are separate actions with separate confirmations.
- Logout, delete, rename and open address the org by username, not alias, so a re-pointed alias cannot redirect them.
- Actions are refused while the last refresh failed, and the org list is read again right before each one.
- A setDefault request carries the worktree it was issued for and is rejected if the focused worktree has changed.
- `sf org display` prints the access token. The worker reads the org ID and discards the rest; the token never reaches the panel.
- Adding an alias that already exists is refused, because the login would overwrite it.

## Renaming an alias

Rename runs `sf alias set` followed by `sf alias unset`. If the org is this project's default, the project config is updated to the new alias. Other projects that still use the old alias show `Org: unknown` until you pick a default there. `sf` keeps aliases per machine, not per project.

## Known limits

- Org type is inferred; see the table above.
- The destructive actions (remove login, delete, remove all expired) are covered by unit tests against a mocked `sf`. They have not been run against real orgs.
- A scratch org's `connectedStatus` was not checked against a real scratch org.
- `org list` has a 20 second timeout, which may be short for very large lists. Logins have two minutes.
- Setting a production org as the default asks for no extra confirmation.
- A project with a legacy `.sfdx/sfdx-config.json` can have a second local default that `sf` still honours. The plugin shows whatever `sf config get target-org` reports.

## Development

```sh
orca plugin test     # unit tests, no real orgs needed
orca plugin check    # validates the manifest and renders the panel
orca plugin dev reload ./orca-sf-org-manager
```

| File | Role |
| --- | --- |
| `src/worker.ts` | Refresh loop, request handlers, status bar updates. |
| `src/sf.ts` | Runs `sf --json` with a timeout and classifies failures. |
| `src/actions.ts` | Builds the argument list for each action and refuses unsafe input. |
| `src/org-model.ts` | Parses `sf` output, classifies orgs, builds the status text. |
| `src/panel.tsx` | The sidebar panel. |
| `src/protocol.ts` | Types shared by panel and worker. |
| `docs/spike.md` | Notes on what the Orca plugin API allows. |

## Ideas

- A hook that warns or blocks `sf project deploy` when the default is a production org.
- `sf org list limits` per org, and a Dev Hub default.

## License

[MIT](LICENSE)
