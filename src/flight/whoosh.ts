// ── Fast-travel whoosh (Web Audio) ─────────────────────────────────────────
// Band-passed noise whose centre frequency rises then falls over the jump,
// with a soft envelope. Subtle by design. Everything fails soft: no audio
// context, autoplay restrictions or errors simply mean silence.

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

export interface WhooshHandle { stop(): void }

export function playWhoosh(durationS: number): WhooshHandle | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.setValueAtTime(160, now)
    bp.frequency.exponentialRampToValueAtTime(950, now + durationS * 0.45)
    bp.frequency.exponentialRampToValueAtTime(220, now + durationS)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.05, now + Math.min(0.9, durationS * 0.2))
    g.gain.linearRampToValueAtTime(0.035, now + durationS * 0.75)
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationS)
    src.connect(bp).connect(g).connect(ctx.destination)
    src.start(now)
    src.stop(now + durationS + 0.05)
    const c = ctx
    return {
      stop() {
        try {
          const t = c.currentTime
          g.gain.cancelScheduledValues(t)
          g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
          src.stop(t + 0.3)
        } catch { /* already stopped */ }
      },
    }
  } catch {
    return null
  }
}

export function closeWhoosh(): void {
  try { void ctx?.close() } catch { /* ignore */ }
  ctx = null
  noise = null
}
