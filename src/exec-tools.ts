/**
 * exec-tools — DSH-native tools over ctx.subprocess + ctx.jobs.
 * A governed "run a command" surface: rh_run (foreground collect) and
 * rh_run_bg (background job via ctx.jobs). Built on the harness's own
 * subprocess and job services, so cancellation + tree-scoped termination
 * + ownership come from the harness, not a hand-rolled child_process.
 * @module dsh-righthand/exec-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-jobs'

export const name = 'righthand-exec'
export const inject = ['tools', 'subprocess', 'jobs']

/** Run a command and collect bounded output; returns exit facts + tail. */
export function apply(ctx: Context): void {
  // Producers may start work only while a controller is attached (tool-jobs pattern).
  ctx.jobs.attachController('righthand-exec')
  ctx.tools.register(defineTool({
    name: 'rh_run',
    description: 'Run a single command (argv array, no shell interpretation) in collect mode and return exit facts plus bounded stdout/stderr tail. Cancellation is tree-scoped by the harness subprocess service.',
    parameters: {
      argv: { type: 'array', required: true, items: { type: 'string' }, description: 'Full argv; argv[0] is the executable (e.g. ["node","--version"]).' },
      cwd: { type: 'string', description: 'Working directory (defaults to process.cwd()).' },
      maxOutputBytes: { type: 'integer', description: 'Per-stream in-memory cap (default 4096).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { type: 'number' },
          signal: { type: 'string' },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `exit ${value.exitCode ?? ('signal ' + value.signal)}; stdout=${value.stdout.length}b stderr=${value.stderr.length}b` }],
    },
    async execute(args, exec) {
      const maxBytes = args.maxOutputBytes ?? 4096
      const spec: SubprocessSpawnSpec = {
        argv: args.argv,
        cwd: args.cwd ?? process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes },
          stderr: { maxBytes },
        },
        graceMs: 5000,
        signal: exec.signal,
      }
      const handle = ctx.subprocess.spawn(spec)
      const outcome = await handle.done
      const so = handle.collected.stdout?.readFrom(0)
      const se = handle.collected.stderr?.readFrom(0)
      return {
        exitCode: outcome.exitCode ?? undefined,
        ...outcome.signal !== null ? { signal: String(outcome.signal) } : {},
        stdout: so?.text ?? '',
        stderr: se?.text ?? '',
        stdoutTruncated: so?.lossy ?? false,
        stderrTruncated: se?.lossy ?? false,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_run_bg',
    description: 'Start a command as a background job (owner-scoped, cancellable via the harness job registry). Returns the job id; read it back with the job_output-style flow or the registry.',
    parameters: {
      argv: { type: 'array', required: true, items: { type: 'string' }, description: 'Full argv; argv[0] is the executable.' },
      cwd: { type: 'string', description: 'Working directory (defaults to process.cwd()).' },
      label: { type: 'string', description: 'Short human-readable label for the job.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', required: true },
          label: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `started background job ${value.jobId} (${value.label})` }],
    },
    async execute(args, exec) {
      const label = args.label ?? args.argv.join(' ')
      const jobId = ctx.jobs.start({
        kind: 'bash' as any,
        label,
        owner: exec.agent,
        run() {
          const handle = ctx.subprocess.spawn({
            argv: args.argv,
            cwd: args.cwd ?? process.cwd(),
            stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
            graceMs: 5000,
          })
          return {
            cancel(reason) { handle.terminate() },
            done: (async () => {
              const outcome = await handle.done
              const so = handle.collected.stdout?.readFrom(0)
              const se = handle.collected.stderr?.readFrom(0)
              if (outcome.exitCode === 0) return { status: 'completed' as const, detail: `exit 0`, output: so?.text ?? '' }
              return { status: 'failed' as const, detail: `exit ${outcome.exitCode}`, output: (se?.text ?? '') || (so?.text ?? '') }
            })(),
            readOutput() { return '' },
          }
        },
      })
      return { jobId: String(jobId), label }
    },
  }))
}