export type BoxQuad = [x: number, y: number, width: number, height: number];

export interface BoxModel {
  content: BoxQuad;
  padding: BoxQuad;
  border: BoxQuad;
  margin: BoxQuad;
  offsetTop: number;
  offsetLeft: number;
}

export interface CSSRule {
  selector: string;
  styleSheetIndex: number;
  source: string;
  properties: Record<string, string>;
  specificity: [number, number, number];
  /**
   * Set when this rule only matches because a pseudo-state was force-enabled
   * (e.g. ":hover"). Holds the comma-joined forced pseudo-classes that made it
   * match, so the UI can label it. Absent for normally-matched rules.
   */
  forState?: string;
}

export interface MatchedRule extends CSSRule {}

/** Computed style value map */
export interface ComputedStyles {
  [property: string]: string;
}
