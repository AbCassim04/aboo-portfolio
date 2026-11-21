// ── Single source of truth for the flight-mode planet identification system ──
// Positions are not stored here: flight mode places every body from the real
// ephemeris (src/space/ephemeris.ts) for the sim date. `detectionRadius` is a
// real distance (km): the body's label appears when the ship is closer than it.
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
  detectionRadius: number   // km: label / info appear within this distance
  isSun?:          boolean
  stats:           PlanetStat[]
  funFact:         string
}

export const PLANET_DATA: PlanetDatum[] = [
  {
    key: 'sun', name: 'The Sun', abbr: '☉', subtitle: 'G-type main-sequence star',
    colorHex: 0xffcc33, colorCss: '#ffcc33',
    detectionRadius: 2.4e8, isSun: true,
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
    detectionRadius: 5e6,
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
    detectionRadius: 1.2e7,
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
    detectionRadius: 1.3e7,
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
    detectionRadius: 7e6,
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
    detectionRadius: 1.4e8,
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
    detectionRadius: 1.2e8,
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
    detectionRadius: 5e7,
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
    detectionRadius: 5e7,
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

// ── Other navigable things (navigation registry, info cards) ────────────────
// Same shape as PLANET_DATA so the info card can show any of them.
// detectionRadius: the in-flight label appears within this distance (km).
export const EXTRA_INFO: PlanetDatum[] = [
  {
    key: 'moon', name: 'The Moon', abbr: 'Mo', subtitle: "Earth's natural satellite",
    colorHex: 0xd8d4cc, colorCss: '#d8d4cc',
    detectionRadius: 2.5e6,
    stats: [
      { label: 'Diameter',            value: '3,474 km' },
      { label: 'Distance from Earth', value: '363,000 – 406,000 km' },
      { label: 'Orbital period',      value: '27.3 days' },
      { label: 'Day length',          value: '29.5 Earth days (tidally locked)' },
      { label: 'Surface gravity',     value: '1.62 m/s² (⅙ of Earth)' },
    ],
    funFact: 'The Moon drifts about 3.8 cm further from Earth every year.',
  },
  {
    key: 'iss', name: 'ISS', abbr: 'ISS', subtitle: 'International Space Station',
    colorHex: 0xe6e9ef, colorCss: '#e6e9ef',
    detectionRadius: 60_000,
    stats: [
      { label: 'Altitude',       value: '~420 km' },
      { label: 'Speed',          value: '7.66 km/s (27,600 km/h)' },
      { label: 'Orbital period', value: '92.7 minutes' },
      { label: 'Span',           value: '109 m' },
      { label: 'Crewed since',   value: 'November 2000' },
    ],
    funFact: 'The crew sees about 16 sunrises and 16 sunsets every day. (Orbit shown here is decorative.)',
  },
  {
    key: 'jwst', name: 'JWST', abbr: 'JW', subtitle: 'James Webb Space Telescope',
    colorHex: 0xf3c86b, colorCss: '#f3c86b',
    detectionRadius: 3e6,
    stats: [
      { label: 'Location',  value: 'Sun–Earth L2, 1.5 million km from Earth' },
      { label: 'Mirror',    value: '6.5 m, 18 gold-coated segments' },
      { label: 'Sunshield', value: '21 × 14 m, five layers' },
      { label: 'Launched',  value: '25 December 2021' },
    ],
    funFact: 'Its sunshield keeps the instruments below −223 °C while the sunny side reaches about 85 °C.',
  },
  {
    key: 'belt', name: 'Asteroid Belt', abbr: 'Belt', subtitle: 'Main belt, 2.2 – 3.3 AU',
    colorHex: 0xb9a07a, colorCss: '#b9a07a',
    detectionRadius: 0,
    stats: [
      { label: 'Location',      value: '2.2 – 3.3 AU from the Sun' },
      { label: 'Largest body',  value: 'Ceres, 940 km across' },
      { label: 'Total mass',    value: '~3 % of the Moon' },
      { label: 'Typical spacing', value: '~1 million km between km-sized rocks' },
    ],
    funFact: 'The real belt is almost empty — in flight the local field is shown far denser so there is something to fly through.',
  },
  {
    key: 'zone', name: 'Portfolio Zone', abbr: 'Zone', subtitle: 'About · Skills · Projects · Contact · M87*',
    colorHex: 0x9b4fc0, colorCss: '#9b4fc0',
    detectionRadius: 0,
    stats: [
      { label: 'Where',    value: 'Near Earth (not to scale)' },
      { label: 'Contains', value: 'About, Skills, Projects, Contact and the M87* portal' },
      { label: 'How',      value: 'Fly to a marker and land (F / LAND) to open it' },
    ],
    funFact: 'This is where the journey starts — the spawn point looks back at Earth.',
  },
  {
    key: 'ABOUT', name: 'About', abbr: 'Ab', subtitle: 'Portfolio · who I am',
    colorHex: 0x7721b1, colorCss: '#9b4fc0', detectionRadius: 0,
    stats: [{ label: 'Opens', value: 'Background, studies and interests' }],
    funFact: 'Land on the marker (F / LAND) to open it.',
  },
  {
    key: 'SKILLS', name: 'Skills', abbr: 'Sk', subtitle: 'Portfolio · what I use',
    colorHex: 0x3b8bd4, colorCss: '#3b8bd4', detectionRadius: 0,
    stats: [{ label: 'Opens', value: 'Languages, frameworks and tools' }],
    funFact: 'Land on the marker (F / LAND) to open it.',
  },
  {
    key: 'PROJECTS', name: 'Projects', abbr: 'Pr', subtitle: 'Portfolio · what I built',
    colorHex: 0x22c55e, colorCss: '#22c55e', detectionRadius: 0,
    stats: [{ label: 'Opens', value: 'Swapify and AI safety research' }],
    funFact: 'Land on the marker (F / LAND) to open it.',
  },
  {
    key: 'CONTACT', name: 'Contact', abbr: 'Co', subtitle: 'Portfolio · get in touch',
    colorHex: 0xd7e2ea, colorCss: '#d7e2ea', detectionRadius: 0,
    stats: [{ label: 'Opens', value: 'Email and social links' }],
    funFact: 'Land on the marker (F / LAND) to open it.',
  },
  {
    key: 'M87*', name: 'M87*', abbr: 'M87', subtitle: 'Black hole portal (not to scale)',
    colorHex: 0x8b5cf6, colorCss: '#8b5cf6', detectionRadius: 0,
    stats: [
      { label: 'Real distance', value: '55 million light-years (Virgo A)' },
      { label: 'Mass',          value: '6.5 billion Suns' },
      { label: 'First imaged',  value: 'Event Horizon Telescope, 2019' },
    ],
    funFact: 'Land on the portal (F / LAND) to fly into a ray-traced black hole.',
  },
]

/** Info for any navigable key (planets, Sun, and EXTRA_INFO). */
export function findInfo(key: string | null): PlanetDatum | null {
  if (!key) return null
  return PLANET_DATA.find(p => p.key === key) ?? EXTRA_INFO.find(p => p.key === key) ?? null
}
