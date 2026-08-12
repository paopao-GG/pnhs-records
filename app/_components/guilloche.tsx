/**
 * Guilloche watermark.
 *
 * The interlaced rosette engraved into banknotes, passports and share certificates. It sits at
 * a few percent opacity behind the learner-identity plate and does one job: say "instrument of
 * record" before a single word is read.
 *
 * Drawn as inline SVG rather than a background image because the alternative is a data URI the
 * size of a paragraph, and because it has to be sized to its plate. Nothing is fetched — see
 * the rule at the top of globals.css.
 *
 * The curves are hypotrochoids: a point at distance `d` from the centre of a circle of radius
 * `r` rolling inside a circle of radius `R`. The petal count is R/r, so the three rings below
 * are deliberately co-prime-ish to keep them from overlapping into mush.
 */

interface Ring {
  R: number;
  r: number;
  d: number;
  width: number;
}

const RINGS: Ring[] = [
  { R: 90, r: 18, d: 34, width: 0.6 },
  { R: 78, r: 13, d: 28, width: 0.5 },
  { R: 62, r: 11, d: 22, width: 0.5 },
];

/** One closed hypotrochoid, as an SVG path, centred on (100, 100). */
function rosette({ R, r, d }: Ring): string {
  const k = R - r;
  // Revolutions needed for the curve to return to its start. The third ring takes eleven of
  // them, which is where the interlacing comes from — and why step count has to scale with it
  // rather than being fixed, or that ring renders as a polygon.
  const turns = r / gcd(R, r);
  const steps = Math.round(220 * turns);
  const pts: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const x = 100 + k * Math.cos(t) + d * Math.cos((k / r) * t);
    const y = 100 + k * Math.sin(t) - d * Math.sin((k / r) * t);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return `M${pts.join("L")}Z`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function Guilloche() {
  return (
    <div className="guilloche" aria-hidden="true">
      <svg viewBox="0 0 200 200" fill="none" stroke="currentColor">
        {RINGS.map((ring, i) => (
          <path key={i} d={rosette(ring)} strokeWidth={ring.width} />
        ))}
        <circle cx="100" cy="100" r="96" strokeWidth="0.6" />
        <circle cx="100" cy="100" r="44" strokeWidth="0.5" />
      </svg>
    </div>
  );
}
