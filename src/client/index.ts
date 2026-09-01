/**
 * Righthand panel client half: a collapsible right-side panel inside the
 * DSH Web GUI showing the plugin's live state - settings, store keys,
 * tasks and events - and mutating it through the /righthand/* routes the
 * host half (src/gui.ts) registers. Same-plugin GUI: no separate package.
 */

import {
  createElement as h,
  useEffect,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Required services: the slot registry (client runtime). */
export const inject = ['slots']

const C = {
  bg: '#15171a',
  panel: '#1b1e23',
  row: '#23272e',
  border: '#2d323a',
  text: '#e6e8ec',
  dim: '#9aa3ad',
  accent: '#3b82f6',
  green: '#3fbf6e',
  red: '#e5484d',
  amber: '#d9a13b',
}

interface State {
  settings: Record<string, unknown>
  storeKeys: string[]
  tasks: any[]
  events: any[]
}

const EMPTY: State = { settings: {}, storeKeys: [], tasks: [], events: [] }

function fmt(s: unknown, n: number): string {
  try { const t = JSON.stringify(s); return t === undefined ? '' : (t.length > n ? t.slice(0, n) + '...' : t) }
  catch { return String(s) }
}

function Row(props: { label: string; value: string; tone?: string }): ReturnType<typeof h> {
  return h('div', { style: { display: 'flex', gap: 8, justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 } },
    h('span', { style: { color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.label),
    h('span', { style: { color: props.tone ?? C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' } }, props.value),
  )
}

function Btn(props: { label: string; onClick: () => void; tone?: string; danger?: boolean }): ReturnType<typeof h> {
  const base: CSSProperties = {
    background: C.row, color: props.danger ? C.red : (props.tone ?? C.text),
    border: '1px solid ' + C.border, borderRadius: 6, padding: '3px 10px',
    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap'
  }
  return h('button', { style: base, onClick: props.onClick }, props.label)
}

function Section(props: { title: string; children?: any }): ReturnType<typeof h> {
  return h('div', { style: { marginTop: 14 } },
    h('div', { style: { fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.dim, marginBottom: 6 } }, props.title),
    props.children,
  )
}

function RighthandPanel(): ReturnType<typeof h> {
  const [collapsed, setCollapsed] = useState(false)
  const [state, setState] = useState<State>(EMPTY)
  const [error, setError] = useState('')
  const [patch, setPatch] = useState('{}')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const load = (): void => {
    fetch('/righthand/state').then(r => r.json()).then((d: State) => { setState(d); setError('') })
      .catch((e: Error) => setError(String(e)))
  }
  useEffect(() => { load() }, [])

  const post = (path: string, body: unknown, then: () => void): void => {
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()).then((d: any) => { if (!d.ok && d.error) setError(String(d.error)); then() })
      .catch((e: Error) => setError(String(e)))
  }

  const railStyle: CSSProperties = {
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 44, background: C.panel,
    borderLeft: '1px solid ' + C.border, display: 'flex', flexDirection: 'column',
    alignItems: 'center', paddingTop: 12, gap: 10, zIndex: 9998
  }
  const panelStyle: CSSProperties = {
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 340, background: C.bg,
    borderLeft: '1px solid ' + C.border, padding: 12, overflowY: 'auto', zIndex: 9998,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: C.text, fontSize: 13
  }

  const toggle = h('button', {
    style: { background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer' },
    onClick: () => setCollapsed(!collapsed),
  }, collapsed ? '<' : '>')

  const refreshBtn = h(Btn, { label: 'Refresh', onClick: load })

  if (collapsed) {
    return createPortal(h('div', { style: railStyle, 'data-dsh-righthand-panel': 'collapsed' },
      toggle,
      h('span', { style: { color: C.green, fontSize: 10, width: 8, height: 8, borderRadius: '50%', background: C.green } }),
      h('span', { style: { color: C.dim, fontSize: 11, writingMode: 'vertical-rl', letterSpacing: '0.12em', userSelect: 'none' } }, 'Righthand'),
    ), document.body)
  }

  return createPortal(h('div', { style: panelStyle, 'data-dsh-righthand-panel': 'expanded' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 } },
      h('span', { style: { fontWeight: 600, letterSpacing: '0.05em' } }, 'Righthand'),
      h('span', { style: { display: 'flex', gap: 6 } }, refreshBtn, toggle),
    ),
    error !== '' ? h('div', { style: { color: C.red, fontSize: 11, marginBottom: 8 } }, error) : null,

    h(Section, { title: 'Settings' },
      Object.entries(state.settings).map(([k, v]) => h(Row, { key: k, label: k, value: fmt(v, 90) })),
      h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
        h('input', {
          value: patch, onChange: (e: any) => setPatch(e.target.value),
          style: { flex: 1, background: C.row, color: C.text, border: '1px solid ' + C.border, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' },
        }),
        h(Btn, { label: 'Patch', onClick: () => {
          try { const p = JSON.parse(patch); post('/righthand/settings/set', { patch: p }, load) }
          catch { setError('patch must be JSON') }
        } }),
      ),
    ),

    h(Section, { title: 'Store (' + state.storeKeys.length + ')' },
      state.storeKeys.length === 0 ? h('div', { style: { color: C.dim, fontSize: 12 } }, '(empty)') : null,
      state.storeKeys.map(k => h('div', { key: k, style: { display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' } },
        h('span', { style: { flex: 1, fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, k),
        h(Btn, { label: 'Delete', danger: true, onClick: () => post('/righthand/store/delete', { key: k }, load) }),
      )),
      h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
        h('input', { placeholder: 'key', value: newKey, onChange: (e: any) => setNewKey(e.target.value), style: { flex: 1, background: C.row, color: C.text, border: '1px solid ' + C.border, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' } }),
        h('input', { placeholder: 'json value', value: newValue, onChange: (e: any) => setNewValue(e.target.value), style: { flex: 1, background: C.row, color: C.text, border: '1px solid ' + C.border, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' } }),
        h(Btn, { label: 'Put', onClick: () => {
          if (newKey === '') { setError('key required'); return }
          try { const v = JSON.parse(newValue === '' ? 'null' : newValue); post('/righthand/store/put', { key: newKey, value: v }, () => { load(); setNewKey(''); setNewValue('') }) }
          catch { setError('value must be JSON') }
        } }),
      ),
    ),

    h(Section, { title: 'Tasks (' + state.tasks.length + ')' },
      state.tasks.length === 0 ? h('div', { style: { color: C.dim, fontSize: 12 } }, '(none)') : null,
      state.tasks.map((t: any) => h('div', { key: t.id, style: { display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' } },
        h('span', { style: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (t.state === 'done' ? '[x] ' : t.state === 'failed' ? '[!] ' : '[ ] ') + t.title),
        h(Btn, { label: 'Done', tone: C.green, onClick: () => post('/righthand/task/update', { id: t.id, state: 'done' }, load) }),
        h(Btn, { label: 'Fail', danger: true, onClick: () => post('/righthand/task/update', { id: t.id, state: 'failed' }, load) }),
      )),
    ),

    h(Section, { title: 'Events (' + state.events.length + ')' },
      state.events.length === 0 ? h('div', { style: { color: C.dim, fontSize: 12 } }, '(none)') : null,
      state.events.map((e: any) => h('div', { key: e.id, style: { display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' } },
        h('span', { style: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.title + ' @ ' + e.at + ' [' + e.state + ']'),
        e.state === 'pending' ? h(Btn, { label: 'Cancel', danger: true, onClick: () => post('/righthand/event/cancel', { id: e.id }, load) }) : null,
      )),
    ),
  ), document.body)
}

/**
 * Client plugin body: register the panel into the frame-wide overlay slot.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'righthand-panel',
    order: 60,
  }, RighthandPanel))
}