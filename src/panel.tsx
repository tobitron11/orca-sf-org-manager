// Salesforce Org Manager panel: current org card + org list + management actions.
import {
  atom, Badge, Box, Button, Callout, Code, Collapsible, Heading, IconButton, Input, plugin, read, Row, Select, Separator, set, Stack, Text,
  type PanelContext
} from 'orca'
import { TYPE_LABEL, TYPE_TONE, type OrgInfo } from './org-model'
import type { ActionResult, SfState } from './protocol'

const state = atom<SfState | null>(null)
const message = atom<ActionResult | null>(null)
const confirmDelete = atom<string | null>(null)
const typedAlias = atom('')
const confirmLogout = atom<string | null>(null)
const confirmExpired = atom(false)
const orgIds = atom<Record<string, string>>({})
const renameValue = atom<Record<string, string>>({})
const addOpen = atom(false)
const addAlias = atom('')
const addKind = atom<'production' | 'sandbox' | 'custom'>('sandbox')
const addUrl = atom('')

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('sf.state', (s) => set(state, s)))
  void plugin.request('sf.state').then((s) => set(state, s))
  void plugin.request('sf.refresh').then((s) => set(state, s))
}

async function run(job: Promise<ActionResult>): Promise<void> {
  const r = await job
  set(message, r)
  set(confirmDelete, null)
  set(confirmLogout, null)
  set(confirmExpired, false)
  set(typedAlias, '')
}

/** Only shown when there is no default to feature in the list. */
function DefaultProblem({ s }: { s: SfState }) {
  if (!s.ok) return <Callout tone="warning" title="Org: unknown">Could not read orgs: {s.error ?? 'unknown error'}</Callout>
  if (!s.orgs.some((o) => o.isProjectDefault)) return <Callout tone="neutral" title="No default org">This project has no target-org. Pick one below.</Callout>
  return null
}

function OrgItem({ o, busy, cwd, featured = false, global = false }: { o: OrgInfo; busy: boolean; cwd: string; featured?: boolean; global?: boolean }) {
  const deleting = read(confirmDelete) === o.alias
  const loggingOut = read(confirmLogout) === o.alias
  const canDelete = o.type === 'sandbox' || o.type === 'scratch'
  const draft = read(renameValue)[o.alias] ?? o.alias
  const renamed = draft.trim()
  const canRename = renamed !== '' && renamed !== o.alias && !renamed.startsWith('-') && !renamed.includes('=')
  const body = (
    <Box direction="column" gap="xs" paddingY={featured ? 'none' : 'sm'}>
      <Row gap="xs" align="center" wrap justify="between">
        <Text weight="semibold" truncate>{o.alias}</Text>
        <Row gap="xs" wrap>
          <Badge tone={TYPE_TONE[o.type]}>{TYPE_LABEL[o.type]}</Badge>
                    {o.connected ? null : <Badge tone="warning">Not connected</Badge>}
        </Row>
      </Row>
      <Text size="xs" muted truncate>{o.username}</Text>
      <Row gap="xs" wrap>
        {global && o.connected ? (
          <Button size="sm" variant="outline" disabled={busy} onPress={() => run(plugin.request('sf.setDefault', { alias: o.alias, cwd }))}>Pin to this project</Button>
        ) : null}
        {!o.isProjectDefault && o.connected ? (
          <Button size="sm" variant="outline" disabled={busy} onPress={() => run(plugin.request('sf.setDefault', { alias: o.alias, cwd }))}>Set default</Button>
        ) : null}
        {o.connected ? <Button size="sm" variant="ghost" icon="open-external" disabled={busy} onPress={() => run(plugin.request('sf.open', { alias: o.alias }))}>Open</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy} onPress={() => run(plugin.request('sf.relogin', { alias: o.alias }))}>
          {o.connected ? 'Re-login' : 'Re-login (expired)'}
        </Button>
      </Row>
      <Collapsible title="Manage" onChange={(open) => {
        if (!open || read(orgIds)[o.username]) return
        void plugin.request('sf.display', { alias: o.alias }).then((r) =>
          set(orgIds, { ...read(orgIds), [o.username]: r.ok && r.orgId ? r.orgId : `unavailable: ${r.message}` }))
      }}>
        <Stack gap="sm">
          <Row gap="xs" align="center" wrap>
            <Text size="xs" muted>Org ID</Text>
            <Code>{read(orgIds)[o.username] ?? 'loading…'}</Code>
          </Row>
          <Input label="Alias (label)" value={draft} onChange={(v) => set(renameValue, { ...read(renameValue), [o.alias]: v })} />
          <Row gap="xs" wrap>
            <Button size="sm" disabled={busy || !canRename} onPress={() => run(plugin.request('sf.rename', { alias: o.alias, newAlias: renamed }))}>Rename</Button>
          </Row>
          <Text size="xs" muted>Other projects that point at "{o.alias}" will show "unknown" until you set a new default there.</Text>
          <Row gap="xs" wrap>
            <Button size="sm" variant="ghost" tone="danger" disabled={busy} onPress={() => set(confirmLogout, o.alias)}>Remove login</Button>
            {canDelete ? <Button size="sm" variant="ghost" tone="danger" disabled={busy} onPress={() => set(confirmDelete, o.alias)}>Delete org…</Button> : null}
          </Row>
          {loggingOut ? (
            <Callout tone="warning" title={`Remove local login for ${o.alias}?`}>
              <Stack gap="xs">
                <Text size="xs">Only forgets the login on this machine. The org itself is not touched.</Text>
                <Row gap="xs" wrap>
                  <Button size="sm" tone="danger" onPress={() => run(plugin.request('sf.logout', { alias: o.alias }))}>Remove login</Button>
                  <Button size="sm" variant="ghost" onPress={() => set(confirmLogout, null)}>Cancel</Button>
                </Row>
              </Stack>
            </Callout>
          ) : null}
          {deleting ? (
            <Callout tone="danger" title={`Delete ${o.alias} permanently?`}>
              <Stack gap="xs">
                <Text size="xs">This destroys the {TYPE_LABEL[o.type]} org in Salesforce. Type the alias to confirm.</Text>
                <Input label="Alias" value={read(typedAlias)} placeholder={o.alias} onChange={(v) => set(typedAlias, v)} />
                <Row gap="xs" wrap>
                  <Button size="sm" tone="danger" disabled={read(typedAlias) !== o.alias}
                    onPress={() => run(plugin.request('sf.delete', { alias: o.alias, confirmAlias: read(typedAlias) }))}>Delete org</Button>
                  <Button size="sm" variant="ghost" onPress={() => { set(confirmDelete, null); set(typedAlias, '') }}>Cancel</Button>
                </Row>
              </Stack>
            </Callout>
          ) : null}
        </Stack>
      </Collapsible>
    </Box>
  )
  if (!featured) return body
  return (
    <Callout tone={global && o.type !== 'production' ? 'warning' : TYPE_TONE[o.type]} icon={global ? 'warning' : 'cloud'}
      title={(o.type === 'production' ? 'PRODUCTION · ' : '') + (global ? 'Global default' : 'Project default')}>
      {global ? <Text size="xs">This project has no default of its own and inherits the global one. Pin it to make it explicit.</Text> : null}
      {body}
    </Callout>
  )
}

function OrgList({ orgs, busy, cwd, global = false }: { orgs: OrgInfo[]; busy: boolean; cwd: string; global?: boolean }) {
  const def = orgs.find((o) => o.isProjectDefault)
  const rest = orgs.filter((o) => !o.isProjectDefault)
  return (
    <Stack gap="sm">
      {def ? <OrgItem o={def} busy={busy} cwd={cwd} featured global={global} /> : null}
      {def && rest.length > 0 ? <Box height={4} background="neutral" radius="full" margin="xs" /> : null}
      <Stack gap="none">
        {rest.map((o, i) => (
          <Stack key={o.username} gap="none">
            {i > 0 ? <Separator /> : null}
            <OrgItem o={o} busy={busy} cwd={cwd} />
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

function AddOrg({ busy }: { busy: boolean }) {
  if (!read(addOpen)) return <Button icon="add" onPress={() => set(addOpen, true)}>Add org</Button>
  const kind = read(addKind)
  const alias = read(addAlias).trim()
  const valid = alias !== '' && !alias.startsWith('-') && (kind !== 'custom' || /^https:\/\/\S+$/.test(read(addUrl)))
  return (
    <Box direction="column" gap="xs" paddingY="sm">
      <Heading level={3}>Add org</Heading>
      <Stack gap="xs">
        <Input label="Alias" value={read(addAlias)} onChange={(v) => set(addAlias, v)} />
        <Select label="Login" value={kind} onChange={(v) => set(addKind, v as 'production' | 'sandbox' | 'custom')}
          options={[{ value: 'sandbox', label: 'Sandbox (test.salesforce.com)' }, { value: 'production', label: 'Production / Dev Edition (login.salesforce.com)' }, { value: 'custom', label: 'Custom domain…' }]} />
        {kind === 'custom' ? <Input label="Instance URL" placeholder="https://acme.my.salesforce.com" value={read(addUrl)} onChange={(v) => set(addUrl, v)} /> : null}
        <Row gap="xs" wrap>
          <Button disabled={!valid || busy} onPress={async () => {
            await run(plugin.request('sf.add', { alias, loginKind: kind, url: read(addUrl) }))
            set(addOpen, false); set(addAlias, ''); set(addUrl, '')
          }}>Log in via browser</Button>
          <Button variant="ghost" onPress={() => set(addOpen, false)}>Cancel</Button>
        </Row>
      </Stack>
    </Box>
  )
}

export default function Panel() {
  const s = read(state)
  const msg = read(message)
  if (!s) return <Text muted>Loading orgs…</Text>
  const busy = s.busy !== null || !s.ok
  const live = s.orgs.filter((o) => o.type !== 'expired')
  const expired = s.orgs.filter((o) => o.type === 'expired')
  return (
    <Stack gap="md">
      <Row justify="between" align="center" wrap>
        <Heading level={2}>Salesforce Orgs</Heading>
        <IconButton icon="refresh" label="Refresh" variant="ghost" size="sm" disabled={busy} onPress={() => run(plugin.request('sf.refresh').then((n) => { set(state, n); return { ok: true, message: 'Refreshed' } }))} />
      </Row>
      <DefaultProblem s={s} />
      {s.busy ? <Text muted size="xs">{s.busy}… (a browser window may open)</Text> : null}
      {msg ? <Callout tone={msg.ok ? 'success' : 'danger'}>{msg.message}</Callout> : null}
      <OrgList orgs={live} busy={busy} cwd={s.cwd ?? ''} global={s.defaultSource?.toLowerCase() === 'global'} />
      <AddOrg busy={busy} />
      {expired.length > 0 ? (
        <Stack gap="xs">
          <Row justify="between">
            <Heading level={3}>Expired ({expired.length})</Heading>
            <Button size="sm" variant="ghost" tone="danger" disabled={busy} onPress={() => set(confirmExpired, true)}>Remove all expired</Button>
          </Row>
          {read(confirmExpired) ? (
            <Callout tone="warning" title={`Remove ${expired.length} expired logins?`}>
              <Stack gap="xs">
                <Text size="xs">{expired.map((o) => o.alias).join(', ')}</Text>
                <Row gap="xs">
                  <Button size="sm" tone="danger" onPress={() => run(plugin.request('sf.removeExpired'))}>Remove logins</Button>
                  <Button size="sm" variant="ghost" onPress={() => set(confirmExpired, false)}>Cancel</Button>
                </Row>
              </Stack>
            </Callout>
          ) : null}
          <OrgList orgs={expired} busy={busy} cwd={s.cwd ?? ''} />
        </Stack>
      ) : null}
      <Text muted size="xs">Checked {s.checkedAt ? new Date(s.checkedAt).toLocaleTimeString() : '–'}. Default is stored in this project's .sf/config.json.</Text>
    </Stack>
  )
}
