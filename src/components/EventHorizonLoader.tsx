// Full-screen "Entering Event Horizon" loader. Shared by App's Suspense fallback
// (while the lazy BlackHoleMode chunk downloads) and BlackHoleMode itself (while
// the renderer initialises), so the hand-off between the two is seamless.
export default function EventHorizonLoader({ visible }: { visible: boolean }) {
  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         50,
        background:     '#060410',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        opacity:        visible ? 1 : 0,
        pointerEvents:  visible ? 'auto' : 'none',
        transition:     'opacity 0.8s ease',
        fontFamily:     'Kanit, sans-serif',
      }}
    >
      <span style={{ color: 'rgba(196,181,253,0.6)', fontSize: '0.7rem', letterSpacing: '0.35em', textTransform: 'uppercase' }}>
        Entering Event Horizon
      </span>
    </div>
  )
}
