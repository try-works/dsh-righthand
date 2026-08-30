/**
 * task-tools — rh_task_* over ctx.storageDomain.
 * A typed task board with a state machine: open → done | failed.
 * `rh_task_next` is the queue discipline — the oldest open task is what to
 * work on now. Descriptions carry the rule that a task's failure is recorded
 * like an answer: a run that could not happen is news the owner needs.
 * @module dsh-righthand/task-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'righthand-task'
export const inject = ['tools', 'storageDomain']

export type TaskState = 'open' | 'done' | 'failed'

export interface Task {
  id: string
  title: string
  detail: string
  due: string
  state: TaskState
  result: string
  createdAt: string
  updatedAt: string
}

/** Domain spec: the typed task table. */
export const taskDomain = defineDomain({
  name: 'righthand_tasks',
  version: 1,
  tables: {
    tasks: domainTable(z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      due: z.string(),
      state: z.enum(['open', 'done', 'failed']),
      result: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })),
  },
})

export type TaskDomain = Domain<typeof taskDomain>

function newId(): string {
  return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

/** Open the task domain and register the model-facing tools. */
export function apply(ctx: Context): void {
  let domain: TaskDomain | undefined
  let ready: Promise<void> | undefined

  ctx.effect(() => {
    ready = (async () => {
      domain = await ctx.storageDomain.open(taskDomain)
    })()
    return () => { /* domain facility owns the domain */ }
  })

  const ensure = async (): Promise<TaskDomain> => {
    if (domain === undefined) { await ready; }
    if (domain === undefined) throw new Error('righthand tasks are not open (storageDomain not mounted)')
    return domain
  }

  const all = async (): Promise<Task[]> => {
    const d = await ensure()
    return [...d.table('tasks').entries()].map(([, t]) => t)
  }

  ctx.tools.register(defineTool({
    name: 'rh_task_create',
    description: 'Add a task with a title, optional detail and due date. Returns the created task with a generated id and state open. A task the agent cannot run is still recorded — its failure is delivered like an answer.',
    parameters: {
      title: { type: 'string', required: true, description: 'What the task is, e.g. "deploy vision-worker".' },
      detail: { type: 'string', description: 'Optional longer description of what done means.' },
      due: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'task ' + value.id + ' created: ' + value.title + ' (open)' }],
    },
    async execute(args) {
      const d = await ensure()
      const now = new Date().toISOString()
      const task: Task = {
        id: newId(),
        title: args.title.trim(),
        detail: args.detail ?? '',
        due: args.due ?? '',
        state: 'open',
        result: '',
        createdAt: now,
        updatedAt: now,
      }
      if (task.title === '') throw new Error('a task needs a title')
      await d.table('tasks').put(task.id, task)
      return { id: task.id, title: task.title, state: task.state }
    },
  }))
ctx.tools.register(defineTool({
    name: 'rh_task_list',
    description: 'List tasks, open ones first (oldest open first). Optionally filter by state.',
    parameters: {
      state: { type: 'string', description: 'Filter: open | done | failed. Omit for all tasks.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            title: { type: 'string', required: true },
            state: { type: 'string', required: true },
            due: { type: 'string' },
          },
        },
      },
      render: (_args, tasks) => [{ type: 'text', text: tasks.length === 0 ? '(no tasks)' : tasks.map((t: any) => '[' + t.state + '] ' + t.title).join(' / ') }],
    },
    async execute(args) {
      const tasks = await all()
      const wanted = args.state ?? null
      const filtered = wanted ? tasks.filter(t => t.state === wanted) : tasks
      const rank = { open: 0, done: 1, failed: 2 } as Record<string, number>
      filtered.sort((a, b) => (rank[a.state] - rank[b.state]) || a.createdAt.localeCompare(b.createdAt))
      return filtered.map(t => ({ id: t.id, title: t.title, state: t.state, ...t.due ? { due: t.due } : {} }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_task_next',
    description: 'The next open task — what to work on now. Oldest open task first. Returns found: false when nothing is open.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          id: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          due: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.found ? 'next: ' + value.title : '(nothing open)' }],
    },
    async execute() {
      const tasks = await all()
      const open = tasks.filter(t => t.state === 'open').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const t = open[0]
      if (t === undefined) return { found: false }
      return { found: true, id: t.id, title: t.title, ...t.detail ? { detail: t.detail } : {}, ...t.due ? { due: t.due } : {} }
    },
  }))
ctx.tools.register(defineTool({
    name: 'rh_task_update',
    description: 'Change a task: its state (open | done | failed) and/or its result. A failed task should carry its result — what was tried and what went wrong — so the record says what happened, not just that something did.',
    parameters: {
      id: { type: 'string', required: true, description: 'The task id from rh_task_create or rh_task_list.' },
      state: { type: 'string', description: 'New state: open | done | failed.' },
      result: { type: 'string', description: 'What happened — the outcome, or the failure reason.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
          state: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.found ? 'task ' + value.id + ' -> ' + value.state : 'task ' + value.id + ' not found' }],
    },
    async execute(args) {
      const d = await ensure()
      const task = d.table('tasks').get(args.id)
      if (task === undefined) return { found: false, id: args.id, state: 'open' }
      const next: Task = {
        ...task,
        ...args.state !== undefined ? { state: args.state as TaskState } : {},
        ...args.result !== undefined ? { result: args.result } : {},
        updatedAt: new Date().toISOString(),
      }
      await d.table('tasks').put(args.id, next)
      return { found: true, id: args.id, state: next.state }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_task_delete',
    description: 'Remove a task by id. Returns whether it existed.',
    parameters: {
      id: { type: 'string', required: true, description: 'The task id to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          existed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'deleted ' + value.id + ': ' + value.existed }],
    },
    async execute(args) {
      const d = await ensure()
      const existed = await d.table('tasks').delete(args.id)
      return { id: args.id, existed }
    },
  }))
}



