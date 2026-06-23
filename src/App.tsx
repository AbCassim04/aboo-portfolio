import { useState } from 'react'
import HubMode    from './modes/HubMode'
import FlightMode from './modes/FlightMode'

export default function App() {
  const [mode, setMode] = useState<'hub' | 'flight'>('hub')

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', overflow: 'hidden', background: '#0C0C0C' }}>
      {mode === 'hub'
        ? <HubMode    onTakeFlight={() => setMode('flight')} />
        : <FlightMode onExit={() => setMode('hub')} />
      }
    </div>
  )
}
