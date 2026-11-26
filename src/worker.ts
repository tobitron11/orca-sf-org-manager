// Salesforce Org Manager worker: reads `sf` state for the focused workspace, drives the status bar,
// answers the panel. `sf` runs as a child process (trusted-worker); nothing here writes to an org
// except the explicit user actions built in actions.ts.
import type { OrcaWorkerApi } from 'orca/worker'
import { buildAction, type Action } from './actions'
import { parseOrgList, parseTargetOrg, statusFor, type OrgInfo } from './org-model'
import type { ActionResult, SfState } from './protocol'
import { defaultExec, runSf, type Exec } from './sf'

const REFRESH_MS = 60_000
const LOGIN_TIMEOUT_MS = 300_000

const EMPTY: SfState = { ok: false, orgs: [], defaultAlias: null, defaultSource: null, targetOrg: null, checkedAt: 0, cwd: null, error: null, busy: null }

let timer: ReturnType<typeof setInterval> | undefined
export function deactivate(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}

export function createActivate(exec: Exec = defaultExec) {
  return function activate(orca: OrcaWorkerApi): void {
    let state: SfState = { ...EMPTY }
    let busyLabel: string | null = null
    let actionChain: Promise<unknown> = Promise.resolve()
    let inflight: Promise<SfState> | null = null
    let dirty = false

    /** Actions run one at a time; refreshes are NOT queued behind them (a login can take minutes). */
    const queue = <T>(job: () => Promise<T>): Promise<T> => {
      const next = actionChain.then(job, job)
      actionChain = next.catch(() => undefined)
      return next
    }

    /** Only a local workspace that Orca can name; otherwise unknown (never the previous worktree). */
    async function resolveCwd(): Promise<string | null> {
      try {
        const ctx = await orca.host.call('workspace.readContext')
        if (!ctx?.workspaceId) return null
        const list = await orca.host.call('workspace.list')
        const hit = list.workspaces.find((w) => w.id === ctx.workspaceId)
        if (!hit?.path || (hit.hostId && hit.hostId !== 'local')) return null
        return hit.path
      } catch (e) {
        orca.log(`cwd lookup failed: ${String(e)}`)
        return null
      }
    }

    async function publish(): Promise<void> {
      const view = statusFor(state.orgs, state.ok, state.targetOrg, state.defaultSource)
      await orca.host
        .call('statusBar.update', { id: 'sf-org', text: view.text, tone: view.tone, tooltip: view.tooltip, icon: view.icon })
        .catch((e) => orca.log(`statusBar.update failed: ${String(e)}`))
      orca.panels.post('sf.state', state)
    }

    async function doRefresh(): Promise<void> {
      const cwd = await resolveCwd()
      const fail = (error: string) => {
        state = { ...EMPTY, cwd, checkedAt: Date.now(), error, busy: busyLabel }
      }
      if (!cwd) {
        fail('no local workspace focused')
      } else {
        const cfg = await runSf(['config', 'get', 'target-org'], cwd, exec)
        const list = await runSf(['org', 'list'], cwd, exec)
        if (!cfg.ok && cfg.reason !== 'sf-error') fail(`config read: ${cfg.reason}`)
        else if (!list.ok) fail(list.reason === 'sf-error' ? list.message : list.reason)
        else {
          const target = cfg.ok ? parseTargetOrg(cfg.json) : { value: null, source: null }
          const orgs = parseOrgList(list.json, target.value)
          const def = orgs.find((o) => o.isProjectDefault)
          state = { ok: true, orgs, defaultAlias: def?.alias ?? null, defaultSource: target.source, targetOrg: target.value, checkedAt: Date.now(), cwd, error: null, busy: busyLabel }
        }
      }
      await publish()
    }

    /** At most one refresh runs; requests that arrive meanwhile trigger one more run. */
    function refresh(): Promise<SfState> {
      if (inflight) {
        dirty = true
        return inflight
      }
      inflight = (async () => {
        try {
          do {
            dirty = false
            await doRefresh()
          } while (dirty)
        } finally {
          inflight = null
        }
        return state
      })()
      return inflight
    }

    const unavailable: ActionResult = { ok: false, message: 'Org state is unavailable; refresh first' }
    const missing = (alias: string): ActionResult => ({ ok: false, message: `Unknown org "${alias}"` })

    async function act(a: Action, label: string, timeoutMs = 20_000): Promise<ActionResult> {
      let args: string[]
      try {
        args = buildAction(a)
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
      busyLabel = label
      state = { ...state, busy: label }
      orca.panels.post('sf.state', state)
      try {
        const r = await runSf(args, state.cwd ?? undefined, exec, timeoutMs)
        return r.ok ? { ok: true, message: `${label}: done` } : { ok: false, message: `${label}: ${r.reason === 'sf-error' ? r.message : r.reason}` }
      } finally {
        busyLabel = null
        await refresh()
      }
    }

    /** Re-read state inside the action job so checks never use a stale or failed snapshot. */
    async function fresh(): Promise<boolean> {
      await refresh()
      return state.ok
    }
    const find = (alias: string): OrgInfo | undefined => state.orgs.find((o) => o.alias === alias)

    orca.panels.handle('sf.state', () => state)
    orca.panels.handle('sf.refresh', () => refresh())
    orca.panels.handle('sf.setDefault', ({ alias, cwd }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        if (cwd !== state.cwd) return { ok: false, message: 'The focused worktree changed; refresh and try again' }
        return find(alias) ? act({ kind: 'setDefault', alias }, `Set default ${alias}`) : missing(alias)
      })
    )
    orca.panels.handle('sf.add', ({ alias, loginKind, url }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        if (state.orgs.some((o) => o.alias === alias || o.username === alias)) {
          return { ok: false, message: `"${alias}" already exists. Use Re-login instead of adding it again.` }
        }
        return act({ kind: 'add', alias, loginKind, url }, `Add ${alias}`, LOGIN_TIMEOUT_MS)
      })
    )
    orca.panels.handle('sf.relogin', ({ alias }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        const org = find(alias)
        return org ? act({ kind: 'relogin', org }, `Re-login ${alias}`, LOGIN_TIMEOUT_MS) : missing(alias)
      })
    )
    orca.panels.handle('sf.logout', ({ alias }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        const org = find(alias)
        return org ? act({ kind: 'logout', org }, `Remove login ${alias}`) : missing(alias)
      })
    )
    orca.panels.handle('sf.rename', ({ alias, newAlias }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        const org = find(alias)
        if (!org) return missing(alias)
        const n = newAlias.trim()
        if (!n || n.startsWith('-') || n.includes('=')) return { ok: false, message: 'Alias must not be empty, start with "-" or contain "="' }
        if (state.orgs.some((o) => o.alias === n || o.username === n)) return { ok: false, message: `"${n}" already exists` }
        const wasDefault = org.isProjectDefault
        const set = await act({ kind: 'aliasSet', org, newAlias: n }, `Rename ${alias}`)
        if (!set.ok) return set
        const unset = await act({ kind: 'aliasUnset', alias }, `Rename ${alias}`)
        if (!unset.ok) return { ok: false, message: `Renamed, but old alias "${alias}" could not be removed: ${unset.message}` }
        // The project config points at the alias; keep it pointing at this org.
        if (wasDefault) return act({ kind: 'setDefault', alias: n }, `Update project default to ${n}`)
        return { ok: true, message: `Renamed ${alias} to ${n}` }
      })
    )
    // Read-only; deliberately returns the id alone. `org display` also prints the access token.
    orca.panels.handle('sf.display', async ({ alias }) => {
      const org = find(alias)
      if (!state.ok || !org) return { ok: false, orgId: null, message: `Unknown org "${alias}"` }
      const r = await runSf(['org', 'display', '--target-org', org.username], state.cwd ?? undefined, exec)
      if (!r.ok) return { ok: false, orgId: null, message: r.reason === 'sf-error' ? r.message ?? 'sf error' : r.reason }
      const id = (r.json as { result?: { id?: unknown } } | null)?.result?.id
      return typeof id === 'string' ? { ok: true, orgId: id, message: '' } : { ok: false, orgId: null, message: 'No org id in sf output' }
    })
    orca.panels.handle('sf.open', ({ alias }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        const org = find(alias)
        return org ? act({ kind: 'open', org }, `Open ${alias}`, 30_000) : missing(alias)
      })
    )
    orca.panels.handle('sf.delete', ({ alias, confirmAlias }) =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        const org = find(alias)
        return org ? act({ kind: 'delete', org, confirmAlias }, `Delete ${alias}`, 120_000) : missing(alias)
      })
    )
    orca.panels.handle('sf.removeExpired', () =>
      queue(async () => {
        if (!(await fresh())) return unavailable
        const expired = state.orgs.filter((o) => o.type === 'expired')
        let failed = 0
        for (const o of expired) if (!(await act({ kind: 'logout', org: o }, `Remove login ${o.alias}`)).ok) failed++
        return { ok: failed === 0, message: `Removed ${expired.length - failed} of ${expired.length} expired logins` }
      })
    )

    orca.events.on('workspace.changed', () => {
      // Never leave the previous worktree's org on screen while the new one is read.
      void orca.host.call('statusBar.update', { id: 'sf-org', text: 'Org: checking…', tone: 'warning', icon: 'warning' }).catch(() => undefined)
      void refresh()
    })
    deactivate()
    timer = setInterval(() => void refresh(), REFRESH_MS)
    void refresh()
  }
}

export default createActivate()
