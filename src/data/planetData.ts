// ── Single source of truth for the flight-mode planet identification system ──
// Positions here MUST match where the planets are placed in FlightMode.tsx
// (they are static — they only spin in place — so a fixed position is valid).
// Consumed by: the 3D→screen planet labels, the info panels, and the NAV radar.

export interface PlanetStat {
  label: string
  value: string
}

export interface PlanetDatum {
  key:             string
  name:            string
  abbr:            string   // short tag shown on the radar
  subtitle:        string   // the "Type" line, shown under the name
  colorHex:        number   // characteristic colour (three.js hex)
  colorCss:        string   // same colour as a CSS string
  position:        [number, number, number]
  detectionRadius: number   // label / info appear within this world-space range
  isSun?:          boolean
  stats:           PlanetStat[]
  funFact:         string
}

export const PLANET_DATA: PlanetDatum[] = [
  {
    key: 'sun', name: 'The Sun', abbr: '☉', subtitle: 'G-type main-sequence star',
    colorHex: 0xffcc33, colorCss: '#ffcc33',
    position: [-4000, 0, 0], detectionRadius: 800, isSun: true,
    stats: [
      { label: 'Type',                value: 'G-type main-sequence star' },
      { label: 'Age',                 value: '4.6 billion years' },
      { label: 'Diameter',            value: '1,392,700 km (109× Earth)' },
      { label: 'Surface temperature', value: '5,500°C' },
      { label: 'Distance from Earth', value: '149.6 million km (1 AU)' },
    ],
    funFact: 'The Sun contains 99.86% of all mass in the solar system.',
  },
  {
    key: 'mercury', name: 'Mercury', abbr: 'Me', subtitle: 'Terrestrial planet',
    colorHex: 0xb0a89f, colorCss: '#b0a89f',
    position: [-2800, 0, 20], detectionRadius: 200,
    stats: [
      { label: 'Type',              value: 'Terrestrial planet' },
      { label: 'Diameter',          value: '4,879 km' },
      { label: 'Distance from Sun', value: '0.39 AU' },
      { label: 'Day length',        value: '59 Earth days' },
      { label: 'Year length',       value: '88 Earth days' },
      { label: 'Moons',             value: '0' },
    ],
    funFact: 'Mercury has extreme temperature swings — from −180°C at night to 430°C during the day.',
  },
  {
    key: 'venus', name: 'Venus', abbr: 'V', subtitle: 'Terrestrial planet',
    colorHex: 0xe8c9a0, colorCss: '#e8c9a0',
    position: [-2000, 0, -30], detectionRadius: 250,
    stats: [
      { label: 'Type',              value: 'Terrestrial planet' },
      { label: 'Diameter',          value: '12,104 km' },
      { label: 'Distance from Sun', value: '0.72 AU' },
      { label: 'Day length',        value: '243 Earth days (longer than its year)' },
      { label: 'Year length',       value: '225 Earth days' },
      { label: 'Moons',             value: '0' },
    ],
    funFact: 'Venus rotates backwards — the Sun rises in the west and sets in the east.',
  },
  {
    key: 'earth', name: 'Earth', abbr: 'E', subtitle: 'Terrestrial planet',
    colorHex: 0x3b8bd4, colorCss: '#3b8bd4',
    position: [0, 0, 0], detectionRadius: 300,
    stats: [
      { label: 'Type',              value: 'Terrestrial planet' },
      { label: 'Diameter',          value: '12,742 km' },
      { label: 'Distance from Sun', value: '1 AU (149.6 million km)' },
      { label: 'Day length',        value: '24 hours' },
      { label: 'Year length',       value: '365.25 days' },
      { label: 'Moons',             value: '1 (The Moon)' },
    ],
    funFact: 'Earth is the only known planet with liquid water on its surface and life.',
  },
  {
    key: 'mars', name: 'Mars', abbr: 'Ma', subtitle: 'Terrestrial planet',
    colorHex: 0xc0562b, colorCss: '#c0562b',
    position: [800, 0, 20], detectionRadius: 250,
    stats: [
      { label: 'Type',              value: 'Terrestrial planet' },
      { label: 'Diameter',          value: '6,779 km' },
      { label: 'Distance from Sun', value: '1.52 AU' },
      { label: 'Day length',        value: '24 hours 37 minutes' },
      { label: 'Year length',       value: '687 Earth days' },
      { label: 'Moons',             value: '2 (Phobos and Deimos)' },
    ],
    funFact: 'Mars has the tallest volcano in the solar system — Olympus Mons at 21.9 km high.',
  },
  {
    key: 'jupiter', name: 'Jupiter', abbr: 'J', subtitle: 'Gas giant',
    colorHex: 0xd8a06a, colorCss: '#d8a06a',
    position: [2500, 0, -40], detectionRadius: 500,
    stats: [
      { label: 'Type',              value: 'Gas giant' },
      { label: 'Diameter',          value: '139,820 km (11× Earth)' },
      { label: 'Distance from Sun', value: '5.2 AU' },
      { label: 'Day length',        value: '9 hours 56 minutes (fastest rotation)' },
      { label: 'Year length',       value: '11.86 Earth years' },
      { label: 'Moons',             value: '95 known moons' },
    ],
    funFact: 'The Great Red Spot is a storm that has been raging for over 350 years.',
  },
  {
    key: 'saturn', name: 'Saturn', abbr: '♄', subtitle: 'Gas giant',
    colorHex: 0xe6cd8f, colorCss: '#e6cd8f',
    position: [4000, 0, 30], detectionRadius: 500,
    stats: [
      { label: 'Type',              value: 'Gas giant' },
      { label: 'Diameter',          value: '116,460 km' },
      { label: 'Distance from Sun', value: '9.58 AU' },
      { label: 'Day length',        value: '10 hours 42 minutes' },
      { label: 'Year length',       value: '29.46 Earth years' },
      { label: 'Moons',             value: '146 known moons (most in the solar system)' },
    ],
    funFact: 'Saturn is the least dense planet — it would float in water.',
  },
  {
    key: 'uranus', name: 'Uranus', abbr: 'U', subtitle: 'Ice giant',
    colorHex: 0xa6e2e6, colorCss: '#a6e2e6',
    position: [6000, 0, -20], detectionRadius: 400,
    stats: [
      { label: 'Type',              value: 'Ice giant' },
      { label: 'Diameter',          value: '50,724 km' },
      { label: 'Distance from Sun', value: '19.2 AU' },
      { label: 'Day length',        value: '17 hours 14 minutes' },
      { label: 'Year length',       value: '84 Earth years' },
      { label: 'Moons',             value: '27 known moons' },
    ],
    funFact: 'Uranus rotates on its side — its axial tilt is 97.8 degrees.',
  },
  {
    key: 'neptune', name: 'Neptune', abbr: 'N', subtitle: 'Ice giant',
    colorHex: 0x3f66cc, colorCss: '#3f66cc',
    position: [8000, 0, 10], detectionRadius: 400,
    stats: [
      { label: 'Type',              value: 'Ice giant' },
      { label: 'Diameter',          value: '49,244 km' },
      { label: 'Distance from Sun', value: '30.07 AU' },
      { label: 'Day length',        value: '16 hours 6 minutes' },
      { label: 'Year length',       value: '164.8 Earth years' },
      { label: 'Moons',             value: '16 known moons' },
    ],
    funFact: 'Neptune has the strongest winds in the solar system — up to 2,100 km/h.',
  },
]
