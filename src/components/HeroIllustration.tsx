export default function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 520 580"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      aria-label="Developer at desk illustration"
    >
      <defs>
        <radialGradient id="hi-monitorGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3B8BD4" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#3B8BD4" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hi-floorGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7721B1" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#7721B1" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hi-eye1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60b4f0" stopOpacity="1" />
          <stop offset="100%" stopColor="#3B8BD4" stopOpacity="0.7" />
        </radialGradient>
        <radialGradient id="hi-eye2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#b06aee" stopOpacity="1" />
          <stop offset="100%" stopColor="#7721B1" stopOpacity="0.7" />
        </radialGradient>
        <linearGradient id="hi-screenGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#050312" />
          <stop offset="100%" stopColor="#020209" />
        </linearGradient>
        <filter id="hi-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="hi-softGlow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="520" height="580" fill="#0C0C0C" />

      {/* Ambient glow behind monitor */}
      <ellipse cx="210" cy="330" rx="170" ry="148" fill="url(#hi-monitorGlow)" />
      {/* Floor glow */}
      <ellipse cx="240" cy="540" rx="210" ry="32" fill="url(#hi-floorGlow)" />

      {/* ── CHAIR (drawn first, behind person) ── */}
      {/* Chair back */}
      <rect x="388" y="295" width="24" height="118" rx="10" fill="#141428" stroke="#1e1e3c" strokeWidth="1.5" />
      {/* Chair seat */}
      <rect x="362" y="406" width="72" height="16" rx="7" fill="#141428" stroke="#1e1e3c" strokeWidth="1.5" />
      {/* Chair pole */}
      <rect x="394" y="422" width="8" height="36" rx="3" fill="#0c0c1c" />
      {/* Wheels */}
      <ellipse cx="382" cy="460" rx="7" ry="5" fill="#0c0c1c" />
      <ellipse cx="406" cy="460" rx="7" ry="5" fill="#0c0c1c" />

      {/* ── MONITOR ── */}
      {/* Body */}
      <rect x="106" y="238" width="206" height="192" rx="10" fill="#141428" stroke="#22224c" strokeWidth="2" />
      {/* Screen */}
      <rect x="117" y="249" width="184" height="171" rx="7" fill="url(#hi-screenGrad)" />
      {/* Screen blue tint overlay */}
      <rect x="117" y="249" width="184" height="171" rx="7" fill="#3B8BD4" opacity="0.03" />

      {/* — Code lines on screen — */}
      {/* Block 1 */}
      <rect x="130" y="264" width="74" height="4" rx="2" fill="#3B8BD4" opacity="0.85" />
      <rect x="210" y="264" width="40" height="4" rx="2" fill="#7721B1" opacity="0.8" />
      <rect x="138" y="276" width="52" height="4" rx="2" fill="#60b4f0" opacity="0.7" />
      <rect x="196" y="276" width="44" height="4" rx="2" fill="#a055d4" opacity="0.7" />
      <rect x="138" y="288" width="68" height="4" rx="2" fill="#3B8BD4" opacity="0.6" />

      {/* Math symbols — the centrepiece */}
      <text x="130" y="314" fontFamily="Georgia, serif" fontSize="20" fill="#60b4f0" opacity="0.95" filter="url(#hi-glow)">∑</text>
      <text x="157" y="314" fontFamily="Georgia, serif" fontSize="20" fill="#a055d4" opacity="0.95" filter="url(#hi-glow)">∫</text>
      <text x="185" y="313" fontFamily="'Courier New', monospace" fontSize="18" fill="#3B8BD4" opacity="0.95" filter="url(#hi-glow)">λ</text>
      {/* Cursor blink */}
      <rect x="212" y="299" width="5" height="14" rx="1" fill="#3B8BD4" opacity="0.9" filter="url(#hi-glow)" />

      {/* Block 2 */}
      <rect x="130" y="328" width="88" height="4" rx="2" fill="#3B8BD4" opacity="0.48" />
      <rect x="138" y="340" width="62" height="4" rx="2" fill="#60b4f0" opacity="0.46" />
      <rect x="206" y="340" width="34" height="4" rx="2" fill="#7721B1" opacity="0.46" />
      <rect x="138" y="352" width="50" height="4" rx="2" fill="#3B8BD4" opacity="0.38" />
      <rect x="130" y="364" width="82" height="4" rx="2" fill="#3B8BD4" opacity="0.36" />
      <rect x="138" y="376" width="58" height="4" rx="2" fill="#60b4f0" opacity="0.32" />
      <rect x="202" y="376" width="38" height="4" rx="2" fill="#a055d4" opacity="0.32" />
      <rect x="138" y="388" width="72" height="4" rx="2" fill="#3B8BD4" opacity="0.28" />
      <rect x="130" y="400" width="65" height="4" rx="2" fill="#60b4f0" opacity="0.24" />

      {/* Monitor stand */}
      <rect x="202" y="430" width="14" height="20" rx="3" fill="#0e0e1e" />
      {/* Monitor base */}
      <rect x="174" y="448" width="70" height="8" rx="4" fill="#0e0e1e" />

      {/* ── KEYBOARD ── */}
      <rect x="148" y="440" width="158" height="12" rx="4" fill="#141428" stroke="#1e1e3c" strokeWidth="1" />
      {/* Top key row */}
      <rect x="156" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="166" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="176" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="186" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="196" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="206" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="216" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="226" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="236" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      <rect x="246" y="443" width="7" height="4" rx="1" fill="#1c1c3a" />
      {/* Space bar */}
      <rect x="166" y="449" width="106" height="3" rx="1.5" fill="#1c1c3a" />

      {/* ── PERSON ── */}
      {/* Torso */}
      <rect x="363" y="300" width="68" height="108" rx="18" fill="#1c1c42" />
      {/* Shirt centre seam */}
      <rect x="394" y="300" width="3" height="60" rx="1.5" fill="#141438" opacity="0.5" />
      {/* Neck */}
      <rect x="392" y="279" width="10" height="23" rx="4" fill="#c8a882" />
      {/* Head */}
      <ellipse cx="397" cy="261" rx="27" ry="29" fill="#c8a882" />
      {/* Hair */}
      <ellipse cx="397" cy="242" rx="27" ry="12" fill="#0e0700" />
      <rect x="370" y="238" width="54" height="23" rx="7" fill="#0e0700" />
      <rect x="370" y="245" width="8" height="22" rx="4" fill="#0e0700" />
      <rect x="419" y="245" width="8" height="22" rx="4" fill="#0e0700" />
      {/* Eyes */}
      <ellipse cx="388" cy="257" rx="3.5" ry="4" fill="#1a0a00" />
      <ellipse cx="406" cy="257" rx="3.5" ry="4" fill="#1a0a00" />
      {/* Eye glints */}
      <circle cx="389.5" cy="255" r="1.2" fill="white" />
      <circle cx="407.5" cy="255" r="1.2" fill="white" />
      {/* Glasses */}
      <rect x="381" y="252" width="14" height="10" rx="4" fill="none" stroke="#3B8BD4" strokeWidth="1.5" opacity="0.85" />
      <rect x="398" y="252" width="14" height="10" rx="4" fill="none" stroke="#3B8BD4" strokeWidth="1.5" opacity="0.85" />
      <line x1="395" y1="257" x2="398" y2="257" stroke="#3B8BD4" strokeWidth="1.2" opacity="0.85" />
      <line x1="381" y1="257" x2="373" y2="259" stroke="#3B8BD4" strokeWidth="1.2" opacity="0.7" />
      <line x1="412" y1="257" x2="420" y2="259" stroke="#3B8BD4" strokeWidth="1.2" opacity="0.7" />
      {/* Nose */}
      <ellipse cx="397" cy="265" rx="2.5" ry="2" fill="#b89070" opacity="0.75" />
      {/* Mouth */}
      <path d="M 390 273 Q 397 278 404 273" stroke="#0e0700" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {/* Left arm — reaching toward keyboard */}
      <path d="M 366 346 Q 330 376 272 444" stroke="#1c1c42" strokeWidth="16" fill="none" strokeLinecap="round" />
      <path d="M 366 346 Q 330 376 272 444" stroke="#c8a882" strokeWidth="10" fill="none" strokeLinecap="round" />
      {/* Left hand */}
      <ellipse cx="272" cy="446" rx="12" ry="7" fill="#c8a882" />
      {/* Right arm — resting on armrest */}
      <path d="M 428 346 Q 442 382 438 432" stroke="#1c1c42" strokeWidth="16" fill="none" strokeLinecap="round" />
      <path d="M 428 346 Q 442 382 438 432" stroke="#c8a882" strokeWidth="10" fill="none" strokeLinecap="round" />
      {/* Right hand */}
      <ellipse cx="438" cy="434" rx="12" ry="7" fill="#c8a882" />

      {/* ── DESK SURFACE (drawn after monitor/person to mask lower portions) ── */}
      <rect x="45" y="452" width="418" height="12" rx="4" fill="#14142a" />
      {/* Desk left leg */}
      <rect x="62" y="464" width="10" height="82" rx="3" fill="#0c0c1e" />
      {/* Desk right leg */}
      <rect x="391" y="464" width="10" height="82" rx="3" fill="#0c0c1e" />
      {/* Desk front apron */}
      <rect x="62" y="464" width="339" height="22" rx="2" fill="#10101e" />

      {/* ── BOOKS (on desk, leftmost) ── */}
      {/* Top book */}
      <rect x="56" y="386" width="46" height="24" rx="3" fill="#1a1a70" />
      <rect x="56" y="386" width="6" height="24" rx="2" fill="#2c2caa" />
      {/* Middle book */}
      <rect x="53" y="410" width="52" height="28" rx="3" fill="#3B8BD4" opacity="0.92" />
      <rect x="53" y="410" width="6" height="28" rx="2" fill="#60b4f0" opacity="0.92" />
      {/* Bottom book */}
      <rect x="50" y="438" width="58" height="16" rx="3" fill="#7721B1" opacity="0.95" />
      <rect x="50" y="438" width="6" height="16" rx="2" fill="#a044d4" opacity="0.95" />

      {/* ── ROBOT (small, on desk right of monitor) ── */}
      {/* Body */}
      <rect x="322" y="396" width="42" height="58" rx="8" fill="#080820" stroke="#3B8BD4" strokeWidth="1.5" />
      {/* Head */}
      <rect x="327" y="370" width="32" height="28" rx="6" fill="#080820" stroke="#3B8BD4" strokeWidth="1.5" />
      {/* Antenna */}
      <rect x="342" y="357" width="4" height="15" rx="2" fill="#3B8BD4" />
      {/* Antenna tip */}
      <circle cx="344" cy="354" r="5" fill="#3B8BD4" filter="url(#hi-softGlow)" />
      <circle cx="344" cy="354" r="3.5" fill="#60b4f0" />
      {/* Eyes */}
      <circle cx="336" cy="383" r="4.5" fill="url(#hi-eye1)" filter="url(#hi-glow)" />
      <circle cx="350" cy="383" r="4.5" fill="url(#hi-eye2)" filter="url(#hi-glow)" />
      <circle cx="336" cy="383" r="1.6" fill="white" />
      <circle cx="350" cy="383" r="1.6" fill="white" />
      {/* Mouth LED */}
      <rect x="331" y="391" width="22" height="3" rx="1.5" fill="#3B8BD4" opacity="0.88" filter="url(#hi-glow)" />
      {/* Body panels */}
      <rect x="330" y="406" width="9" height="8" rx="2" fill="#04041a" stroke="#3B8BD4" strokeWidth="0.8" />
      <rect x="345" y="406" width="9" height="8" rx="2" fill="#04041a" stroke="#7721B1" strokeWidth="0.8" />
      {/* Vent lines */}
      <rect x="330" y="420" width="24" height="2" rx="1" fill="#1c1c3a" />
      <rect x="330" y="426" width="24" height="2" rx="1" fill="#1c1c3a" />
      <rect x="330" y="432" width="24" height="2" rx="1" fill="#1c1c3a" />
      {/* Arms */}
      <rect x="308" y="402" width="15" height="26" rx="5" fill="#080820" stroke="#3B8BD4" strokeWidth="1" />
      <rect x="363" y="402" width="15" height="26" rx="5" fill="#080820" stroke="#3B8BD4" strokeWidth="1" />
      {/* Feet */}
      <rect x="326" y="452" width="14" height="8" rx="3" fill="#050518" stroke="#3B8BD4" strokeWidth="1" />
      <rect x="342" y="452" width="14" height="8" rx="3" fill="#050518" stroke="#3B8BD4" strokeWidth="1" />

      {/* ── FLOATING ACCENTS ── */}
      {/* Particles */}
      <circle cx="88" cy="170" r="2" fill="#3B8BD4" opacity="0.5" />
      <circle cx="466" cy="152" r="2.5" fill="#7721B1" opacity="0.5" />
      <circle cx="72" cy="300" r="1.5" fill="#3B8BD4" opacity="0.42" />
      <circle cx="480" cy="340" r="2" fill="#7721B1" opacity="0.5" />
      <circle cx="478" cy="486" r="1.5" fill="#3B8BD4" opacity="0.38" />
      <circle cx="90" cy="505" r="2" fill="#7721B1" opacity="0.34" />
      <circle cx="460" cy="200" r="1.5" fill="#3B8BD4" opacity="0.42" />
      {/* Floating code fragments */}
      <text x="78" y="162" fontFamily="'Courier New', monospace" fontSize="10" fill="#3B8BD4" opacity="0.28">const</text>
      <text x="447" y="190" fontFamily="'Courier New', monospace" fontSize="9" fill="#7721B1" opacity="0.28">import</text>
      <text x="454" y="495" fontFamily="'Courier New', monospace" fontSize="10" fill="#3B8BD4" opacity="0.24">∇loss</text>
      <text x="78" y="490" fontFamily="'Courier New', monospace" fontSize="9" fill="#7721B1" opacity="0.22">async</text>
    </svg>
  )
}
