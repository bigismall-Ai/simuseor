/**
 * 可编辑路径模型：绝对坐标、显式控制点。
 *
 * 为什么先归一化：SVG 的 `d` 允许相对命令、隐式重复、单字符 arc flag，
 * 直接改字符串很容易错位。这里先解析成绝对命令，编辑后再序列化。
 * 代价是 d 会比原来长、相对命令变成绝对命令；对人工编辑可接受。
 */

import { formatNumber, tokenizePath } from './svg-doc';

export type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; rot: number; large: number; sweep: number; x: number; y: number }
  | { type: 'Z' };

export type AnchorRole = 'point' | 'c1' | 'c2';

export interface PathAnchor {
  index: number;
  x: number;
  y: number;
  role: AnchorRole;
  cmd: number;
}

export interface ParsedPath {
  commands: PathCommand[];
  anchors: PathAnchor[];
}

const PARAM_COUNT: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

export function parsePath(d: string): ParsedPath | null {
  const tokens = tokenizePath(d);
  if (!tokens) return null;

  const commands: PathCommand[] = [];
  let index = 0;
  let command = '';
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };

  const read = (count: number): number[] | null => {
    const slice = tokens.slice(index, index + count);
    if (slice.length < count || slice.some((t) => t.kind === 'cmd')) return null;
    index += count;
    return slice.map((t) => Number(t.value));
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === 'cmd') {
      command = token.value;
      index += 1;
      if (command.toLowerCase() === 'z') {
        commands.push({ type: 'Z' });
        current = { ...start };
      }
      continue;
    }

    if (!command) return null;
    const lower = command.toLowerCase();
    const count = PARAM_COUNT[lower];
    if (!count) return null;
    const raw = read(count);
    if (!raw) return null;

    const absolute = command === command.toUpperCase();
    const px = current.x;
    const py = current.y;

    switch (lower) {
      case 'm': {
        const x = absolute ? raw[0] : px + raw[0];
        const y = absolute ? raw[1] : py + raw[1];
        commands.push({ type: 'M', x, y });
        start = { x, y };
        current = { x, y };
        // M 的后续隐式参数是 L。
        command = absolute ? 'L' : 'l';
        break;
      }
      case 'l': {
        const x = absolute ? raw[0] : px + raw[0];
        const y = absolute ? raw[1] : py + raw[1];
        commands.push({ type: 'L', x, y });
        current = { x, y };
        break;
      }
      case 'h': {
        const x = absolute ? raw[0] : px + raw[0];
        commands.push({ type: 'L', x, y: py });
        current = { x, y: py };
        break;
      }
      case 'v': {
        const y = absolute ? raw[0] : py + raw[0];
        commands.push({ type: 'L', x: px, y });
        current = { x: px, y };
        break;
      }
      case 'c': {
        const x1 = absolute ? raw[0] : px + raw[0];
        const y1 = absolute ? raw[1] : py + raw[1];
        const x2 = absolute ? raw[2] : px + raw[2];
        const y2 = absolute ? raw[3] : py + raw[3];
        const x = absolute ? raw[4] : px + raw[4];
        const y = absolute ? raw[5] : py + raw[5];
        commands.push({ type: 'C', x1, y1, x2, y2, x, y });
        current = { x, y };
        break;
      }
      case 's': {
        const last = commands[commands.length - 1];
        const rx = last && last.type === 'C' ? 2 * px - last.x2 : px;
        const ry = last && last.type === 'C' ? 2 * py - last.y2 : py;
        const x2 = absolute ? raw[0] : px + raw[0];
        const y2 = absolute ? raw[1] : py + raw[1];
        const x = absolute ? raw[2] : px + raw[2];
        const y = absolute ? raw[3] : py + raw[3];
        commands.push({ type: 'C', x1: rx, y1: ry, x2, y2, x, y });
        current = { x, y };
        break;
      }
      case 'q': {
        const x1 = absolute ? raw[0] : px + raw[0];
        const y1 = absolute ? raw[1] : py + raw[1];
        const x = absolute ? raw[2] : px + raw[2];
        const y = absolute ? raw[3] : py + raw[3];
        commands.push({ type: 'Q', x1, y1, x, y });
        current = { x, y };
        break;
      }
      case 't': {
        const last = commands[commands.length - 1];
        const x1 = last && last.type === 'Q' ? 2 * px - last.x1 : px;
        const y1 = last && last.type === 'Q' ? 2 * py - last.y1 : py;
        const x = absolute ? raw[0] : px + raw[0];
        const y = absolute ? raw[1] : py + raw[1];
        commands.push({ type: 'Q', x1, y1, x, y });
        current = { x, y };
        break;
      }
      case 'a': {
        const x = absolute ? raw[5] : px + raw[5];
        const y = absolute ? raw[6] : py + raw[6];
        commands.push({
          type: 'A',
          rx: Math.abs(raw[0]),
          ry: Math.abs(raw[1]),
          rot: raw[2],
          large: raw[3] ? 1 : 0,
          sweep: raw[4] ? 1 : 0,
          x,
          y,
        });
        current = { x, y };
        break;
      }
      default:
        return null;
    }
  }

  return { commands, anchors: collectAnchors(commands) };
}

export function collectAnchors(commands: PathCommand[]): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  commands.forEach((cmd, index) => {
    if (cmd.type === 'M' || cmd.type === 'L' || cmd.type === 'A') {
      anchors.push({ index: anchors.length, x: cmd.x, y: cmd.y, role: 'point', cmd: index });
    } else if (cmd.type === 'C') {
      anchors.push({ index: anchors.length, x: cmd.x1, y: cmd.y1, role: 'c1', cmd: index });
      anchors.push({ index: anchors.length, x: cmd.x2, y: cmd.y2, role: 'c2', cmd: index });
      anchors.push({ index: anchors.length, x: cmd.x, y: cmd.y, role: 'point', cmd: index });
    } else if (cmd.type === 'Q') {
      anchors.push({ index: anchors.length, x: cmd.x1, y: cmd.y1, role: 'c1', cmd: index });
      anchors.push({ index: anchors.length, x: cmd.x, y: cmd.y, role: 'point', cmd: index });
    }
  });
  return anchors;
}

/** 拖动一个锚点；端点会带着相邻控制点一起动，保持切线方向。返回新的 anchors。 */
export function moveAnchor(path: ParsedPath, anchorIndex: number, x: number, y: number): PathAnchor[] {
  const anchor = path.anchors[anchorIndex];
  if (!anchor) return path.anchors;
  const cmd = path.commands[anchor.cmd];
  if (!cmd) return path.anchors;

  if (anchor.role === 'c1') {
    if (cmd.type === 'C' || cmd.type === 'Q') {
      cmd.x1 = x;
      cmd.y1 = y;
    }
  } else if (anchor.role === 'c2') {
    if (cmd.type === 'C') {
      cmd.x2 = x;
      cmd.y2 = y;
    }
  } else {
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    if (cmd.type === 'M' || cmd.type === 'L' || cmd.type === 'A') {
      cmd.x = x;
      cmd.y = y;
    } else if (cmd.type === 'C') {
      cmd.x = x;
      cmd.y = y;
      cmd.x2 += dx;
      cmd.y2 += dy;
    } else if (cmd.type === 'Q') {
      cmd.x = x;
      cmd.y = y;
      cmd.x1 += dx;
      cmd.y1 += dy;
    }
  }

  path.anchors = collectAnchors(path.commands);
  return path.anchors;
}

export function serializePath(path: ParsedPath, precision = 3): string {
  const n = (value: number) => formatNumber(value, precision, false);
  const parts: string[] = [];
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
      case 'L':
        parts.push(`${cmd.type}${n(cmd.x)} ${n(cmd.y)}`);
        break;
      case 'C':
        parts.push(
          `C${n(cmd.x1)} ${n(cmd.y1)} ${n(cmd.x2)} ${n(cmd.y2)} ${n(cmd.x)} ${n(cmd.y)}`,
        );
        break;
      case 'Q':
        parts.push(`Q${n(cmd.x1)} ${n(cmd.y1)} ${n(cmd.x)} ${n(cmd.y)}`);
        break;
      case 'A':
        parts.push(
          `A${n(cmd.rx)} ${n(cmd.ry)} ${n(cmd.rot)} ${cmd.large ? 1 : 0} ${cmd.sweep ? 1 : 0} ${n(cmd.x)} ${n(cmd.y)}`,
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

export interface SimplePoint {
  x: number;
  y: number;
}

export function parsePoints(value: string): SimplePoint[] | null {
  const nums = value
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(Number);
  if (nums.length < 2 || nums.length % 2 !== 0 || nums.some((v) => !Number.isFinite(v))) {
    return null;
  }
  const points: SimplePoint[] = [];
  for (let i = 0; i < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
  return points;
}

export function serializePoints(points: SimplePoint[], precision = 3): string {
  return points.map((p) => `${formatNumber(p.x, precision, false)} ${formatNumber(p.y, precision, false)}`).join(' ');
}
