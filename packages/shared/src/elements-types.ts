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
}

export interface MatchedRule extends CSSRule {}

/** Computed style value map */
export interface ComputedStyles {
  [property: string]: string;
}
