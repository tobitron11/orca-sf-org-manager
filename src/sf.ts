// Runs the `sf` CLI as a plain child process (the worker is a trusted Node process).
import { execFile } from 'node:child_process'

export type Exec = (
  file: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number }
) => Promise<{ stdout: string; stderr: string; code: number | string }>

export type SfResult =
  | { ok: true; json: unknown }
  | { ok: false; reason: 'timeout' | 'bad-json' | 'sf-missing' }
  | { ok: false; reason: 'sf-error'; message: string }

export const defaultExec: Exec = (file, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 20_000_000 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null
      const code = !e ? 0 : e.killed ? 'ETIMEDOUT' : typeof e.code === 'string' ? e.code : (e.code ?? 1)
      resolve({ stdout: String(stdout), stderr: String(stderr), code })
    })
  })

/** Appends `--json`; stdout must parse as JSON, warnings on stderr are ignored. */
export async function runSf(args: string[], cwd: string | undefined, exec: Exec = defaultExec, timeoutMs = 20_000): Promise<SfResult> {
  const r = await exec('sf', [...args, '--json'], { cwd, timeoutMs })
  if (r.code === 'ENOENT') return { ok: false, reason: 'sf-missing' }
  if (r.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' }
  let json: unknown
  try {
    json = JSON.parse(r.stdout)
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
  if (r.code !== 0) {
    const message = (json as { message?: unknown } | null)?.message
    return { ok: false, reason: 'sf-error', message: typeof message === 'string' ? message : `sf exited with ${r.code}` }
  }
  return { ok: true, json }
}
