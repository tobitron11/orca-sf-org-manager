import { assert, test } from 'orca/testing'
import { runSf, type Exec } from './sf'
import { buildAction } from './actions'

const ok = (stdout: string): Exec => async () => ({ stdout, stderr: '', code: 0 })

test('runSf passes args as an array (alias with spaces stays one arg) and parses JSON', async () => {
  let seen: string[] = []
  const exec: Exec = async (_f, args) => { seen = args; return { stdout: '{"result":[]}', stderr: 'warning: update available', code: 0 } }
  const r = await runSf(['config', 'set', 'target-org', 'Data 360 Operational Excellence Hands-On Lab'], '/p', exec)
  assert.equal(r.ok, true)
  assert.deepEqual(seen, ['config', 'set', 'target-org', 'Data 360 Operational Excellence Hands-On Lab', '--json'])
})

test('runSf reports sf-missing, timeout and bad-json instead of guessing', async () => {
  const missing: Exec = async () => ({ stdout: '', stderr: '', code: 'ENOENT' })
  assert.deepEqual(await runSf(['org', 'list'], '/p', missing), { ok: false, reason: 'sf-missing' })
  const slow: Exec = async () => ({ stdout: '', stderr: '', code: 'ETIMEDOUT' })
  assert.deepEqual(await runSf(['org', 'list'], '/p', slow), { ok: false, reason: 'timeout' })
  assert.deepEqual(await runSf(['org', 'list'], '/p', ok('Warning: not json {')), { ok: false, reason: 'bad-json' })
})

test('runSf returns sf error JSON (non-zero exit) as failed with message', async () => {
  const exec: Exec = async () => ({ stdout: '{"status":1,"message":"No authorization found"}', stderr: '', code: 1 })
  const r = await runSf(['org', 'logout'], '/p', exec)
  assert.deepEqual(r, { ok: false, reason: 'sf-error', message: 'No authorization found' })
})

const org = (type: string, alias = 'a') => ({ alias, username: 'u', instanceUrl: 'https://x.my.salesforce.com', type, connected: true, isProjectDefault: false }) as any

test('buildAction builds the sf args per action', () => {
  assert.deepEqual(buildAction({ kind: 'setDefault', alias: 'A B' }), ['config', 'set', 'target-org', 'A B'])
  assert.deepEqual(buildAction({ kind: 'add', alias: 'new', loginKind: 'sandbox' }), ['org', 'login', 'web', '--alias', 'new', '--instance-url', 'https://test.salesforce.com'])
  assert.deepEqual(buildAction({ kind: 'add', alias: 'new', loginKind: 'production' }), ['org', 'login', 'web', '--alias', 'new', '--instance-url', 'https://login.salesforce.com'])
  assert.deepEqual(buildAction({ kind: 'add', alias: 'n', loginKind: 'custom', url: 'https://acme.my.salesforce.com' }), ['org', 'login', 'web', '--alias', 'n', '--instance-url', 'https://acme.my.salesforce.com'])
  assert.deepEqual(buildAction({ kind: 'relogin', org: org('sandbox', 'dev19') }), ['org', 'login', 'web', '--alias', 'dev19', '--instance-url', 'https://x.my.salesforce.com'])
  assert.deepEqual(buildAction({ kind: 'logout', org: org('sandbox', 'dev19') }), ['org', 'logout', '--target-org', 'u', '--no-prompt'])
})

test('buildAction never sets the global default and rejects unsafe input', () => {
  assert.equal(buildAction({ kind: 'setDefault', alias: 'x' }).includes('--global'), false)
  assert.throws(() => buildAction({ kind: 'add', alias: '--evil', loginKind: 'sandbox' }))
  assert.throws(() => buildAction({ kind: 'add', alias: '', loginKind: 'sandbox' }))
  assert.throws(() => buildAction({ kind: 'add', alias: 'n', loginKind: 'custom', url: 'http://insecure' }))
  assert.throws(() => buildAction({ kind: 'setDefault', alias: '-g' }))
})

test('delete only for sandbox/scratch and only with the typed alias', () => {
  assert.deepEqual(buildAction({ kind: 'delete', org: org('scratch', 's'), confirmAlias: 's' }), ['org', 'delete', 'scratch', '--target-org', 'u', '--no-prompt'])
  assert.deepEqual(buildAction({ kind: 'delete', org: org('sandbox', 'sb'), confirmAlias: 'sb' }), ['org', 'delete', 'sandbox', '--target-org', 'u', '--no-prompt'])
  assert.throws(() => buildAction({ kind: 'delete', org: org('production', 'p'), confirmAlias: 'p' }))
  assert.throws(() => buildAction({ kind: 'delete', org: org('devedition', 'd'), confirmAlias: 'd' }))
  assert.throws(() => buildAction({ kind: 'delete', org: org('expired', 'e'), confirmAlias: 'e' }))
  assert.throws(() => buildAction({ kind: 'delete', org: org('sandbox', 'sb'), confirmAlias: 'nope' }))
})
