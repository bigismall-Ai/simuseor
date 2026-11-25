/** 跨组件共享的轻量类型。 */

export interface SvgPick {
  tag: string;
  id: string | null;
  selector: string;
  attrs: [string, string][];
}

export interface SvgBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
