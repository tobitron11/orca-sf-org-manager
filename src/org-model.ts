// Pure parsing/classification of `sf org list --json` and `sf config get target-org --json`.
export type OrgType = 'production' | 'sandbox' | 'scratch' | 'devedition' | 'expired' | 'unknown'
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export type OrgInfo = {
  alias: string
  username: string
  instanceUrl: string
  type: OrgType
  connected: boolean
  isProjectDefault: boolean
}

type RawOrg = Record<string, unknown>

// Anchored on the host: `brainstorm-co` or `trailblazer-corp` are real production My Domains.
const DEV_HOSTS = [
  /^(orgfarm|trailsignup|storm)-[a-z0-9]+\.(my|lightning)\.salesforce\.com$/i,
  /\.trailblaze\.my\.salesforce\.com$/i,
  /\.develop\.my\.salesforce\.com$/i,
  /^[a-z0-9-]+-dev-ed\.[a-z.]*salesforce\.com$/i
]
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** `isSandbox === false` alone does not mean production: demo/dev orgs report false too. */
export function classifyOrg(o: RawOrg): OrgType {
  const status = typeof o.connectedStatus === 'string' ? o.connectedStatus : ''
  if (/error/i.test(status)) return 'expired'
  const url = typeof o.instanceUrl === 'string' ? o.instanceUrl : ''
  if (o.isScratch === true || /\.scratch\./i.test(url)) return 'scratch'
  if (o.isSandbox === true || /\.sandbox\./i.test(url)) return 'sandbox'
  if (!url || o.isSandbox == null) return 'unknown'
  if (DEV_HOSTS.some((re) => re.test(hostOf(url)))) return 'devedition'
  return 'production'
}

export function parseOrgList(json: unknown, targetOrg: string | null): OrgInfo[] {
  const result = (json as { result?: Record<string, unknown> } | null)?.result
  if (!result || typeof result !== 'object') return []
  const rows = [result.nonScratchOrgs, result.scratchOrgs].flatMap((g) => (Array.isArray(g) ? (g as RawOrg[]) : []))
  const seen = new Set<string>()
  const orgs: OrgInfo[] = []
  for (const o of rows) {
    const username = String(o.username ?? '')
    if (!username || seen.has(username)) continue
    seen.add(username)
    const alias = typeof o.alias === 'string' && o.alias ? o.alias : username
    orgs.push({
      alias,
      username,
      instanceUrl: String(o.instanceUrl ?? ''),
      type: classifyOrg(o),
      connected: o.connectedStatus === 'Connected',
      isProjectDefault: targetOrg !== null && (alias === targetOrg || username === targetOrg)
    })
  }
  return orgs
}

export function parseTargetOrg(json: unknown): { value: string | null; source: string | null } {
  const rows = (json as { result?: unknown } | null)?.result
  const hit = Array.isArray(rows) ? (rows as RawOrg[]).find((r) => r.name === 'target-org') : undefined
  if (!hit || typeof hit.value !== 'string' || !hit.value) return { value: null, source: null }
  return { value: hit.value, source: typeof hit.location === 'string' ? hit.location : null }
}

export const TYPE_LABEL: Record<OrgType, string> = {
  production: 'PRODUCTION', sandbox: 'Sandbox', scratch: 'Scratch', devedition: 'Dev/Demo', expired: 'Expired', unknown: 'Unknown'
}
export const TYPE_TONE: Record<OrgType, Tone> = {
  production: 'danger', sandbox: 'success', scratch: 'accent', devedition: 'accent', expired: 'warning', unknown: 'warning'
}

export type StatusView = { text: string; tone: Tone; tooltip: string; icon: 'cloud' | 'warning' }

/** `loaded` false = the last refresh failed: say so instead of guessing. */
export function statusFor(orgs: OrgInfo[], loaded: boolean, targetOrg: string | null = null, source: string | null = null): StatusView {
  if (!loaded) return { text: 'Org: unknown', tone: 'warning', tooltip: 'Could not read Salesforce orgs (is `sf` installed?)', icon: 'warning' }
  const def = orgs.find((o) => o.isProjectDefault)
  if (!def && targetOrg) {
    return { text: `Org: unknown (target-org "${targetOrg}" not found)`, tone: 'warning', tooltip: `target-org "${targetOrg}" matches no logged-in org (login removed, or a second alias?)`, icon: 'warning' }
  }
  if (!def) return { text: 'No default org', tone: 'neutral', tooltip: 'No target-org set for this project', icon: 'cloud' }
  const label = TYPE_LABEL[def.type]
  const prod = def.type === 'production'
  const global = source?.toLowerCase() === 'global'
  return {
    text: (prod ? `${def.alias} · PRODUCTION` : `${def.alias} · ${label}`) + (global ? ' (global)' : ''),
    tone: TYPE_TONE[def.type],
    tooltip: `${def.username}\n${def.instanceUrl}${def.connected ? '' : '\n(not connected)'}${global ? '\nGlobal default: this project has no own setting' : ''}`,
    icon: prod ? 'warning' : 'cloud'
  }
}
