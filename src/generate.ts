export type Line = LineRequire | LineAsk | LineProvide | LineSay;

/**
 * Keys containing `@` are variables, bound to a single name.
 * Variables are parameters bound to an entire storylet.
 *
 * Example:
 * ```
 * [
 *   { require: { key: ['apple', '@X'] } }
 *   { provide: { key: ['color', '@X'], value: ['red'] }}
 * ]
 * ```
 * When `@X` is an `apple`, it is `red`.
 *
 */
export type Key = string;

export type Relation = { key: Key[]; value: Key[] };

export type LineRequire = { req: Relation };
export function isLineRequire(line: Line): line is LineRequire {
  return "req" in line;
}

export type LineAsk = { ask: Relation };
export function isLineAsk(line: Line): line is LineAsk {
  return "ask" in line;
}

export type LineProvide = { provide: Relation };
export function isLineProvide(line: Line): line is LineProvide {
  return "provide" in line;
}
export type LineSay = {
  /**
   * `Key`s are printed verbatim
   * `Key[]` are used to lookup values, then printed verbatim.
   * (This is not yet strong enough, but a good start)
   */
  say: (Key | Key[])[];
};
export function isLineSay(line: Line): line is LineSay {
  return "say" in line;
}
export type Story = {
  lines: Line[];
};
