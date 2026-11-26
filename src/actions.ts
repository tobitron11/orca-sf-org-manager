// Builds the `sf` args for each user action. Everything unsafe is refused here, not in the UI.
import type { OrgInfo } from './org-model'

export type LoginKind = 'production' | 'sandbox' | 'custom'
export type Action =
  | { kind: 'setDefault'; alias: string }
  | { kind: 'add'; alias: string; loginKind: LoginKind; url?: string }
  | { kind: 'relogin'; org: OrgInfo }
  | { kind: 'logout'; org: OrgInfo }
  | { kind: 'aliasSet'; org: OrgInfo; newAlias: string }
  | { kind: 'aliasUnset'; alias: string }
  | { kind: 'open'; org: OrgInfo }
  | { kind: 'delete'; org: OrgInfo; confirmAlias: string }

const LOGIN_URL: Record<'production' | 'sandbox', string> = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com'
}

function safeAlias(alias: string): string {
  if (!alias.trim() || alias.startsWith('-')) throw new Error(`Invalid alias: "${alias}"`)
  return alias
}

export function buildAction(a: Action): string[] {
  switch (a.kind) {
    case 'setDefault':
      // Project-local only: never `--global`.
      return ['config', 'set', 'target-org', safeAlias(a.alias)]
    case 'add': {
      let url: string
      if (a.loginKind === 'custom') {
        if (!a.url || !/^https:\/\/[^\s]+$/.test(a.url)) throw new Error('Custom login needs an https URL')
        url = a.url
      } else url = LOGIN_URL[a.loginKind]
      return ['org', 'login', 'web', '--alias', safeAlias(a.alias), '--instance-url', url]
    }
    case 'relogin': {
      const args = ['org', 'login', 'web', '--alias', safeAlias(a.org.alias)]
      return a.org.instanceUrl ? [...args, '--instance-url', a.org.instanceUrl] : args
    }
    case 'logout':
      // Username, not alias: an alias can be repointed between the check and the run.
      return ['org', 'logout', '--target-org', safeAlias(a.org.username), '--no-prompt']
    case 'aliasSet': {
      const n = a.newAlias.trim()
      if (!n || n.startsWith('-') || n.includes('=')) throw new Error(`Invalid alias: "${a.newAlias}"`)
      return ['alias', 'set', `${n}=${a.org.username}`]
    }
    case 'aliasUnset':
      return ['alias', 'unset', safeAlias(a.alias)]
    case 'open':
      if (!a.org.connected) throw new Error('Org is not connected')
      return ['org', 'open', '--target-org', safeAlias(a.org.username)]
    case 'delete': {
      if (a.org.type !== 'sandbox' && a.org.type !== 'scratch') throw new Error(`Refusing to delete a ${a.org.type} org`)
      if (a.confirmAlias !== a.org.alias) throw new Error('Typed alias does not match')
      return ['org', 'delete', a.org.type, '--target-org', safeAlias(a.org.username), '--no-prompt']
    }
  }
}
