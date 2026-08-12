/**
 * The struck seal.
 *
 * Replaces the rubber stamp the previous design used for promotion status. A stamp is ink
 * pressed onto a page; a seal is an impression made *in* it, and this record is the kind of
 * document that gets sealed.
 *
 * The rim carries the school year so the mark says what it is a mark *of* — a seal with no
 * date on it is decoration.
 */

const TONES = {
  pass: "pass",
  fail: "fail",
  none: "none",
  pending: "pending",
} as const;

export type SealTone = keyof typeof TONES;

/**
 * Breaks a remark across at most three lines.
 *
 * The real values range from "PROMOTED" to "CONDITIONALLY PROMOTED" to "RETAINED IN GRADE 9",
 * so a single line would either overflow the seal or be set too small to read.
 */
function lines(text: string): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return words;

  const out: string[] = [];
  let current = "";

  for (const word of words) {
    // 11 characters is what fits inside the inner keyline at the size chosen below.
    if (current && (current + " " + word).length > 11) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);

  return out.slice(0, 3);
}

export function Seal({
  remark,
  tone,
  rim,
  caption,
}: {
  /** The promotion remark as the record states it. Never computed here. */
  remark: string;
  tone: SealTone;
  /** Set around the top of the rim — the school year the mark belongs to. */
  rim?: string | null;
  /** Set around the bottom of the rim. */
  caption?: string | null;
}) {
  const body = lines(remark.toUpperCase());
  // Long remarks step down a size rather than overflowing the keyline.
  const size = body.length >= 3 ? 15 : body.length === 2 ? 18 : 21;
  const firstY = 100 - ((body.length - 1) * size * 1.12) / 2 + size * 0.35;

  return (
    <svg
      className="seal-mark"
      data-tone={tone}
      viewBox="0 0 200 200"
      fill="none"
      stroke="currentColor"
      role="img"
      aria-label={`${remark}${rim ? `, ${rim}` : ""}`}
    >
      <defs>
        {/*
         * Rim baselines. Both run left to right so the text reads upright on each arc — the top
         * one sweeps over the top (flag 1), the bottom one under the bottom (flag 0). Setting
         * the lower arc right-to-left is the classic way to end up with mirrored text along the
         * bottom of a seal.
         */}
        <path id="seal-rim-top" d="M100,100 m-76,0 a76,76 0 0,1 152,0" />
        <path id="seal-rim-bottom" d="M100,100 m-78,0 a78,78 0 0,0 156,0" />
      </defs>

      {/* Two concentric rules: the difference between a seal and a circle. */}
      <circle cx="100" cy="100" r="94" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="86" strokeWidth="1" />
      <circle cx="100" cy="100" r="62" strokeWidth="1" />

      {/* Cardinal ticks, at the four points an engraver would key the die to. */}
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1="100"
          y1="6"
          x2="100"
          y2="14"
          strokeWidth="1.5"
          transform={`rotate(${deg} 100 100)`}
        />
      ))}

      {rim && (
        <text
          fill="currentColor"
          stroke="none"
          fontSize="13"
          fontWeight="700"
          letterSpacing="2.6"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <textPath href="#seal-rim-top" startOffset="50%" textAnchor="middle">
            {rim}
          </textPath>
        </text>
      )}

      {caption && (
        <text
          fill="currentColor"
          stroke="none"
          fontSize="10"
          fontWeight="700"
          letterSpacing="2.2"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <textPath href="#seal-rim-bottom" startOffset="50%" textAnchor="middle">
            {caption}
          </textPath>
        </text>
      )}

      <text
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        fontSize={size}
        fontWeight="700"
        letterSpacing="1.2"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {body.map((line, i) => (
          <tspan key={i} x="100" y={firstY + i * size * 1.12}>
            {line}
          </tspan>
        ))}
      </text>
    </svg>
  );
}
