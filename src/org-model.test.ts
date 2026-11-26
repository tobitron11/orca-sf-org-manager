import { assert, test } from 'orca/testing'
import { classifyOrg, parseOrgList, parseTargetOrg, statusFor } from './org-model'

const row = (o: Record<string, unknown>) => ({
  alias: 'x', username: 'x@x.com', isSandbox: false, isScratch: false, connectedStatus: 'Connected',
  instanceUrl: 'https://acme.my.salesforce.com', ...o
})
const list = (nonScratch: unknown[], scratch: unknown[] = []) => ({
  result: { nonScratchOrgs: nonScratch, scratchOrgs: scratch }
})

test('classifies orgs by flags, url and connection state', () => {
  assert.equal(classifyOrg(row({ isSandbox: true })), 'sandbox')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://a--devpro.sandbox.my.salesforce.com' })), 'sandbox')
  assert.equal(classifyOrg(row({ isScratch: true })), 'scratch')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://orgfarm-1.my.salesforce.com' })), 'devedition')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://mindful-dev-ed.trailblaze.my.salesforce.com' })), 'devedition')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://trailsignup-1.my.salesforce.com' })), 'devedition')
  assert.equal(classifyOrg(row({})), 'production')
  assert.equal(classifyOrg(row({ isSandbox: true, connectedStatus: 'DomainNotFoundError' })), 'expired')
  assert.equal(classifyOrg(row({ isSandbox: null, instanceUrl: undefined })), 'unknown')
})

test('parseOrgList marks the project default by alias or username', () => {
  const json = list([row({ alias: 'a' }), row({ alias: 'b', username: 'b@b.com' })])
  assert.equal(parseOrgList(json, 'b').find((o) => o.isProjectDefault)?.alias, 'b')
  assert.equal(parseOrgList(json, 'b@b.com').find((o) => o.isProjectDefault)?.alias, 'b')
  assert.equal(parseOrgList(json, null).some((o) => o.isProjectDefault), false)
})

test('parseOrgList merges scratch orgs, dedupes and keeps aliases with spaces', () => {
  const json = list([row({ alias: 'Data 360 Lab' })], [row({ alias: 's', username: 's@s.com', isScratch: true }), row({ alias: 'Data 360 Lab' })])
  const orgs = parseOrgList(json, null)
  assert.equal(orgs.length, 2)
  assert.equal(orgs[0].alias, 'Data 360 Lab')
})

test('parseOrgList tolerates garbage', () => {
  assert.deepEqual(parseOrgList(null, null), [])
  assert.deepEqual(parseOrgList({ result: {} }, null), [])
})

test('parseTargetOrg reads value and source, null when unset', () => {
  assert.deepEqual(parseTargetOrg({ result: [{ name: 'target-org', value: 'cap', location: 'Local' }] }), { value: 'cap', source: 'Local' })
  assert.deepEqual(parseTargetOrg({ result: [] }), { value: null, source: null })
  assert.deepEqual(parseTargetOrg(null), { value: null, source: null })
})

test('statusFor: production is danger and loud, sandbox success, expired warning', () => {
  const org = (o: object) => parseOrgList(list([row({ alias: 'p', ...o })]), 'p')
  const prod = statusFor(org({}), true)
  assert.equal(prod.tone, 'danger')
  assert.match(prod.text, /PRODUCTION/)
  const sb = statusFor(org({ isSandbox: true }), true)
  assert.equal(sb.tone, 'success')
  assert.match(sb.text, /p · Sandbox/)
  assert.equal(statusFor(org({ connectedStatus: 'DomainNotFoundError' }), true).tone, 'warning')
  assert.match(statusFor([], true).text, /No default org/)
  assert.match(statusFor([], false).text, /Org: unknown/)
})

test('H4: production My Domains that merely contain dev-like words stay production', () => {
  for (const host of ['brainstorm-solutions', 'datastorm-inc', 'trailblazer-corp', 'myorgfarm-co']) {
    assert.equal(classifyOrg(row({ instanceUrl: `https://${host}.my.salesforce.com` })), 'production')
  }
  assert.equal(classifyOrg(row({ instanceUrl: 'https://orgfarm-0123456789.my.salesforce.com' })), 'devedition')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://storm-e84acd10b2c463.my.salesforce.com' })), 'devedition')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://x-dev-ed.trailblaze.my.salesforce.com' })), 'devedition')
  assert.equal(classifyOrg(row({ instanceUrl: 'https://x-dev-ed.develop.my.salesforce.com' })), 'devedition')
})

test('H3: a target-org that matches no listed org is unknown, not "no default"', () => {
  const orgs = parseOrgList(list([row({ alias: 'a' })]), 'ghost')
  const v = statusFor(orgs, true, 'ghost')
  assert.equal(v.tone, 'warning')
  assert.match(v.text, /ghost/)
  assert.match(v.text, /not found/)
  assert.match(statusFor(orgs, true, null).text, /No default org/)
})

test('statusFor: a global default is marked as such, local and unknown source are not', () => {
  const orgs = parseOrgList({ result: { nonScratchOrgs: [{ alias: 'wsa', username: 'w@x.com', instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false, connectedStatus: 'Connected' }] } }, 'wsa')
  const g = statusFor(orgs, true, 'wsa', 'Global')
  assert.match(g.text, /\(global\)/)
  assert.match(g.text, /PRODUCTION/)
  assert.match(g.tooltip, /no own setting/i)
  assert.doesNotMatch(statusFor(orgs, true, 'wsa', 'Local').text, /global/i)
  assert.doesNotMatch(statusFor(orgs, true, 'wsa', null).text, /global/i)
})
