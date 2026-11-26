import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createActivate, deactivate } from './worker'
import type { Exec } from './sf'

const org = (alias: string, o: Record<string, unknown> = {}) => ({
  alias, username: `${alias}@x.com`, isSandbox: true, isScratch: false, connectedStatus: 'Connected',
  instanceUrl: `https://${alias}.sandbox.my.salesforce.com`, ...o
})
const LIST = { result: { nonScratchOrgs: [
  org('capstone-final'), org('Data 360 Lab', { isSandbox: false, instanceUrl: 'https://trailsignup-1.my.salesforce.com' }),
  org('prod-org', { isSandbox: false, instanceUrl: 'https://acme.my.salesforce.com' }),
  org('old', { connectedStatus: 'DomainNotFoundError' })
], scratchOrgs: [] } }

function fakeExec(target: string | null, calls: string[][] = []): Exec {
  return async (_f, args) => {
    calls.push(args)
    const key = args.join(' ')
    if (key.startsWith('config get')) return { stdout: JSON.stringify({ result: target ? [{ name: 'target-org', value: target, location: 'Local' }] : [] }), stderr: '', code: 0 }
    if (key.startsWith('org list')) return { stdout: JSON.stringify(LIST), stderr: '', code: 0 }
    return { stdout: '{"status":0,"result":{}}', stderr: '', code: 0 }
  }
}
const mod = (activate: any) => ({ default: activate, deactivate }) as any
const host = () => mockHost({ results: {
  'workspace.readContext': { workspaceId: 'w1', branch: 'main', displayName: 'main', terminals: [] },
  'workspace.list': { workspaces: [{ id: 'w1', kind: 'worktree', name: 'main', path: '/proj', branch: 'main', hostId: null }], truncated: false },
  'statusBar.update': { ok: true }
} })

test('state is read in the focused workspace dir and drives the status bar', async () => {
  const calls: string[][] = []
  const h = host()
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: h })
  const s: any = await w.request('sf.refresh')
  assert.equal(s.ok, true)
  assert.equal(s.cwd, '/proj')
  assert.equal(s.defaultAlias, 'capstone-final')
  const upd: any = h.callsOf('statusBar.update').at(-1)
  assert.equal(upd.id, 'sf-org')
  assert.match(upd.text, /capstone-final · Sandbox/)
  assert.equal(upd.tone, 'success')
  await w.deactivate()
})

test('a production default shows danger tone', async () => {
  const h = host()
  const w = await mountWorker(mod(createActivate(fakeExec('prod-org'))), { host: h })
  await w.request('sf.refresh')
  const upd: any = h.callsOf('statusBar.update').at(-1)
  assert.equal(upd.tone, 'danger')
  assert.match(upd.text, /PRODUCTION/)
  await w.deactivate()
})

test('no default org and failed sf are shown honestly', async () => {
  const h1 = host()
  const w1 = await mountWorker(mod(createActivate(fakeExec(null))), { host: h1 })
  await w1.request('sf.refresh')
  assert.match((h1.callsOf('statusBar.update').at(-1) as any).text, /No default org/)
  await w1.deactivate()
  const broken: Exec = async () => ({ stdout: '', stderr: '', code: 'ENOENT' })
  const h2 = host()
  const w2 = await mountWorker(mod(createActivate(broken)), { host: h2 })
  const s: any = await w2.request('sf.refresh')
  assert.equal(s.ok, false)
  assert.match((h2.callsOf('statusBar.update').at(-1) as any).text, /Org: unknown/)
  await w2.deactivate()
})

test('setDefault quotes nothing, runs project-local in cwd and refuses unknown aliases', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  await w.request('sf.refresh')
  const r: any = await w.request('sf.setDefault', { alias: 'Data 360 Lab', cwd: '/proj' })
  assert.equal(r.ok, true)
  assert.deepEqual(calls.find((c) => c[0] === 'config' && c[1] === 'set'), ['config', 'set', 'target-org', 'Data 360 Lab', '--json'])
  assert.equal(calls.some((c) => c.includes('--global')), false)
  const bad: any = await w.request('sf.setDefault', { alias: 'nope', cwd: '/proj' })
  assert.equal(bad.ok, false)
  await w.deactivate()
})

test('delete is refused for production, dev/demo and expired orgs; wrong typed alias refused', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  await w.request('sf.refresh')
  for (const alias of ['prod-org', 'Data 360 Lab', 'old']) {
    const r: any = await w.request('sf.delete', { alias, confirmAlias: alias })
    assert.equal(r.ok, false)
  }
  assert.equal((await w.request('sf.delete', { alias: 'capstone-final', confirmAlias: 'x' }) as any).ok, false)
  assert.equal(calls.some((c) => c[1] === 'delete'), false)
  const ok: any = await w.request('sf.delete', { alias: 'capstone-final', confirmAlias: 'capstone-final' })
  assert.equal(ok.ok, true)
  assert.deepEqual(calls.find((c) => c[1] === 'delete'), ['org', 'delete', 'sandbox', '--target-org', 'capstone-final@x.com', '--no-prompt', '--json'])
  await w.deactivate()
})

test('removeExpired logs out only expired orgs', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  await w.request('sf.refresh')
  const r: any = await w.request('sf.removeExpired')
  assert.equal(r.ok, true)
  const logouts = calls.filter((c) => c[1] === 'logout')
  assert.deepEqual(logouts, [['org', 'logout', '--target-org', 'old@x.com', '--no-prompt', '--json']])
  await w.deactivate()
})

test('H2: a timed-out config read is unknown, never "No default org"', async () => {
  const exec: Exec = async (_f, args) =>
    args[0] === 'config' ? { stdout: '', stderr: '', code: 'ETIMEDOUT' } : { stdout: JSON.stringify(LIST), stderr: '', code: 0 }
  const h = host()
  const w = await mountWorker(mod(createActivate(exec)), { host: h })
  const s: any = await w.request('sf.refresh')
  assert.equal(s.ok, false)
  assert.match((h.callsOf('statusBar.update').at(-1) as any).text, /Org: unknown/)
  await w.deactivate()
})

test('M1/M2: unresolvable or remote workspace is unknown, never the previous worktree', async () => {
  const h = mockHost({ results: {
    'workspace.readContext': null,
    'workspace.list': { workspaces: [], truncated: false },
    'statusBar.update': { ok: true }
  } })
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: h })
  const s: any = await w.request('sf.refresh')
  assert.equal(s.ok, false)
  assert.equal(calls.length, 0)
  assert.match((h.callsOf('statusBar.update').at(-1) as any).text, /Org: unknown/)
  await w.deactivate()
  const remote = mockHost({ results: {
    'workspace.readContext': { workspaceId: 'w1', branch: 'main', displayName: 'main', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'w1', kind: 'worktree', name: 'main', path: '/proj', branch: 'main', hostId: 'ssh:box' }], truncated: false },
    'statusBar.update': { ok: true }
  } })
  const w2 = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: remote })
  assert.equal(((await w2.request('sf.refresh')) as any).ok, false)
  await w2.deactivate()
})

test('M4: setDefault for a different cwd than the worker currently has is refused', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  await w.request('sf.refresh')
  const r: any = await w.request('sf.setDefault', { alias: 'Data 360 Lab', cwd: '/other' })
  assert.equal(r.ok, false)
  assert.equal(calls.some((c) => c[1] === 'set'), false)
  await w.deactivate()
})

test('M5: adding an existing alias is refused (would repoint it)', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  await w.request('sf.refresh')
  const r: any = await w.request('sf.add', { alias: 'capstone-final', loginKind: 'sandbox', url: '' })
  assert.equal(r.ok, false)
  assert.equal(calls.some((c) => c[1] === 'login'), false)
  await w.deactivate()
})

test('M3: actions are refused while the last refresh failed', async () => {
  let fail = false
  const base = fakeExec('capstone-final')
  const exec: Exec = async (f, a, o) => (fail ? { stdout: '', stderr: '', code: 'ETIMEDOUT' } : base(f, a, o))
  const w = await mountWorker(mod(createActivate(exec)), { host: host() })
  await w.request('sf.refresh')
  fail = true
  await w.request('sf.refresh')
  const r: any = await w.request('sf.logout', { alias: 'old' })
  assert.equal(r.ok, false)
  await w.deactivate()
})

test('H1: a refresh is not blocked by a slow login in progress', async () => {
  let release!: () => void
  const gate = new Promise<void>((res) => (release = res))
  const base = fakeExec('capstone-final')
  const exec: Exec = async (f, a, o) => (a[1] === 'login' ? (await gate, base(f, a, o)) : base(f, a, o))
  const w = await mountWorker(mod(createActivate(exec)), { host: host() })
  await w.request('sf.refresh')
  const login = w.request('sf.add', { alias: 'fresh', loginKind: 'sandbox', url: '' })
  const s: any = await Promise.race([w.request('sf.refresh'), new Promise((r) => setTimeout(() => r('blocked'), 500))])
  assert.notEqual(s, 'blocked')
  release()
  await login
  await w.deactivate()
})

test('rename: sets the new alias, unsets the old one, and keeps the project default pointing at the org', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  try {
    await w.request('sf.refresh')
    const r: any = await w.request('sf.rename', { alias: 'capstone-final', newAlias: 'cap-sandbox' })
    assert.equal(r.ok, true)
    const joined = calls.map((c) => c.filter((x) => x !== '--json').join(' '))
    assert.ok(joined.includes('alias set cap-sandbox=capstone-final@x.com'))
    assert.ok(joined.includes('alias unset capstone-final'))
    assert.ok(joined.includes('config set target-org cap-sandbox'))
    assert.ok(joined.indexOf('alias set cap-sandbox=capstone-final@x.com') < joined.indexOf('alias unset capstone-final'))
  } finally {
    await w.deactivate()
  }
})

test('rename: refuses existing alias, "=", leading "-" and empty names; non-default orgs leave config alone', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  try {
    await w.request('sf.refresh')
    for (const bad of ['prod-org', 'a=b', '-x', '  ']) {
      const r: any = await w.request('sf.rename', { alias: 'capstone-final', newAlias: bad })
      assert.equal(r.ok, false, bad)
    }
    assert.equal(calls.some((c) => c[0] === 'alias'), false)
    const ok: any = await w.request('sf.rename', { alias: 'prod-org', newAlias: 'acme-prod' })
    assert.equal(ok.ok, true)
    assert.equal(calls.some((c) => c.filter((x) => x !== '--json').join(' ') === 'config set target-org acme-prod'), false)
  } finally {
    await w.deactivate()
  }
})

test('open: opens a connected org by username, refuses expired orgs', async () => {
  const calls: string[][] = []
  const w = await mountWorker(mod(createActivate(fakeExec('capstone-final', calls))), { host: host() })
  try {
    await w.request('sf.refresh')
    const r: any = await w.request('sf.open', { alias: 'capstone-final' })
    assert.equal(r.ok, true)
    assert.ok(calls.some((c) => c.filter((x) => x !== '--json').join(' ') === 'org open --target-org capstone-final@x.com'))
    const bad: any = await w.request('sf.open', { alias: 'old' })
    assert.equal(bad.ok, false)
  } finally {
    await w.deactivate()
  }
})


test('display: returns only the org id, never the access token; refuses unknown orgs', async () => {
  const base = fakeExec('capstone-final')
  const exec: Exec = async (f, a, o) =>
    a[0] === 'org' && a[1] === 'display'
      ? { stdout: JSON.stringify({ status: 0, result: { id: '00D000000000001AAA', accessToken: 'SECRET', username: 'x' } }), stderr: '', code: 0 }
      : base(f, a, o)
  const w = await mountWorker(mod(createActivate(exec)), { host: host() })
  try {
    await w.request('sf.refresh')
    const r: any = await w.request('sf.display', { alias: 'capstone-final' })
    assert.equal(r.ok, true)
    assert.equal(r.orgId, '00D000000000001AAA')
    assert.equal(JSON.stringify(r).includes('SECRET'), false)
    const bad: any = await w.request('sf.display', { alias: 'nope' })
    assert.equal(bad.ok, false)
  } finally {
    await w.deactivate()
  }
})

test('a global target-org is flagged in the status bar and the state source is Global', async () => {
  const base = fakeExec(null)
  const exec: Exec = async (f, a, o) =>
    a[0] === 'config' && a[1] === 'get'
      ? { stdout: JSON.stringify({ result: [{ name: 'target-org', value: 'capstone-final', location: 'Global' }] }), stderr: '', code: 0 }
      : base(f, a, o)
  const h = host()
  const w = await mountWorker(mod(createActivate(exec)), { host: h })
  try {
    const s: any = await w.request('sf.refresh')
    assert.equal(s.defaultSource, 'Global')
    assert.match((h.callsOf('statusBar.update').at(-1) as any).text, /\(global\)/)
  } finally {
    await w.deactivate()
  }
})
