// ── window.__spaceon: read-only debug / verification hook ──────────────────
// Enabled in development always, and in production only with `?debug=1`.
// When disabled nothing is installed: every export below is a cheap no-op and
// callers guard their own bookkeeping with DEBUG_ENABLED, so the hook costs
// nothing in a normal production visit.
//
//   await window.__spaceon.waitForReady()   // resolves once the current mode is ready
//   window.__spaceon.getState()             // JSON-serialisable snapshot (see README)
//
// Modes register "providers" (functions returning plain data) that getState()
// calls on demand; nothing is computed per frame for the hook except what a
// provider explicitly keeps (e.g. an FPS counter).

import { getSimClockState, getSimTimeMs } from '../sim/simClock'

export const DEBUG_ENABLED: boolean = (() => {
  if (typeof window === 'undefined') return false
  if (import.meta.env.DEV) return true
  try { return new URLSearchParams(window.location.search).get('debug') === '1' } catch { return false }
})()

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Provider = () => { [k: string]: Json }

interface ConsoleEntry { level: 'error' | 'warn'; message: string; time: string }

const MAX_CONSOLE = 20
const providers   = new Map<string, Provider>()
const consoleLog: ConsoleEntry[] = []
let currentMode   = 'unknown'
let ready         = false
const waiters     = new Set<() => void>()

/** Record the app mode ('hub' | 'flight' | 'blackhole'). */
export function setDebugMode(mode: string): void {
  if (!DEBUG_ENABLED) return
  if (mode !== currentMode) ready = false
  currentMode = mode
}

/** Mark the current mode ready (or not). Resolves pending waitForReady calls. */
export function setDebugReady(flag: boolean): void {
  if (!DEBUG_ENABLED) return
  ready = flag
  if (flag) { for (const w of waiters) w(); waiters.clear() }
}

/** Register a state provider; returns an unregister function. */
export function registerDebugProvider(name: string, fn: Provider): () => void {
  if (!DEBUG_ENABLED) return () => {}
  providers.set(name, fn)
  return () => { if (providers.get(name) === fn) providers.delete(name) }
}

function safeString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return `${v.name}: ${v.message}`
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

function pushConsole(level: ConsoleEntry['level'], args: unknown[]): void {
  consoleLog.push({ level, message: args.map(safeString).join(' ').slice(0, 500), time: new Date().toISOString() })
  if (consoleLog.length > MAX_CONSOLE) consoleLog.splice(0, consoleLog.length - MAX_CONSOLE)
}

function getState(): { [k: string]: Json } {
  const clock = getSimClockState()
  const simMs = getSimTimeMs()
  const out: { [k: string]: Json } = {
    version:  1,
    mode:     currentMode,
    ready,
    wallTime: new Date().toISOString(),
    simClock: {
      simTime: new Date(simMs).toISOString(),
      simMs,
      live:    clock.live,
      paused:  clock.paused,
      speed:   clock.speed,
    },
    console:  consoleLog.map(e => ({ ...e })),
  }
  for (const [name, fn] of providers) {
    try { out[name] = fn() } catch (e) { out[name] = { error: safeString(e) } }
  }
  return out
}

function waitForReady(timeoutMs = 300_000): Promise<{ [k: string]: Json }> {
  if (ready) return Promise.resolve(getState())
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); resolve(getState()) }
    const timer = setTimeout(() => { waiters.delete(done); reject(new Error(`__spaceon: not ready after ${timeoutMs} ms`)) }, timeoutMs)
    waiters.add(done)
  })
}

if (DEBUG_ENABLED) {
  const origError = console.error.bind(console)
  const origWarn  = console.warn.bind(console)
  console.error = (...args: unknown[]) => { pushConsole('error', args); origError(...args) }
  console.warn  = (...args: unknown[]) => { pushConsole('warn',  args); origWarn(...args) }
  window.addEventListener('error', (e) => pushConsole('error', [e.message || 'error event']))
  window.addEventListener('unhandledrejection', (e) => pushConsole('error', ['unhandled rejection', e.reason]))

  Object.defineProperty(window, '__spaceon', {
    value:        Object.freeze({ version: 1, getState, waitForReady }),
    writable:     false,
    configurable: true,   // allows HMR to reinstall in development
    enumerable:   false,
  })
}
