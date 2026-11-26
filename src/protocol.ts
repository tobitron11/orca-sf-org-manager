// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { OrgInfo } from './org-model'

export type SfState = {
  ok: boolean
  orgs: OrgInfo[]
  defaultAlias: string | null
  defaultSource: string | null
  targetOrg: string | null
  checkedAt: number
  cwd: string | null
  error: string | null
  busy: string | null
}
export type ActionResult = { ok: boolean; message: string }

declare module 'orca' {
  interface PluginRequests {
    'sf.state': { output: SfState }
    'sf.refresh': { output: SfState }
    'sf.setDefault': { input: { alias: string; cwd: string }; output: ActionResult }
    'sf.add': { input: { alias: string; loginKind: 'production' | 'sandbox' | 'custom'; url: string }; output: ActionResult }
    'sf.relogin': { input: { alias: string }; output: ActionResult }
    'sf.logout': { input: { alias: string }; output: ActionResult }
    'sf.delete': { input: { alias: string; confirmAlias: string }; output: ActionResult }
    'sf.rename': { input: { alias: string; newAlias: string }; output: ActionResult }
    'sf.display': { input: { alias: string }; output: { ok: boolean; orgId: string | null; message: string } }
    'sf.open': { input: { alias: string }; output: ActionResult }
    'sf.removeExpired': { output: ActionResult }
  }
  interface PluginPanelEvents {
    'sf.state': SfState
  }
}
