import { useState } from 'react'
import HubMode       from './modes/HubMode'
import FlightMode    from './modes/FlightMode'
import BlackHoleMode from './modes/BlackHoleMode'

type AppMode = 'hub' | 'flight' | 'blackhole'

export default function App() {
  const _qs = new URLSearchParams(window.location.search).get('mode') as AppMode | null
  const [mode, setMode] = useState<AppMode>(_qs ?? 'hub')

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', overflow: 'hidden', background: '#0C0C0C' }}>
      {mode === 'hub' && (
        <HubMode onTakeFlight={() => setMode('flight')} />
      )}
      {mode === 'flight' && (
        <FlightMode
          onExit={() => setMode('hub')}
          onEnterBlackHole={() => setMode('blackhole')}
        />
      )}
      {mode === 'blackhole' && (
        <BlackHoleMode onExit={() => setMode('flight')} />
      )}
    </div>
  )
}
