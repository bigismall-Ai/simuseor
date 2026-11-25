/**
 * 极简 ZIP 写入器（store 模式，不压缩）。
 *
 * 只为一个场景服务：把批量优化的 SVG 与报告打包下载。
 * 不引第三方依赖，文件名按 UTF-8 写入（general purpose flag bit 11）。
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  private readonly parts: number[] = [];

  get length(): number {
    return this.parts.length;
  }

  u8(value: number): void {
    this.parts.push(value & 0xff);
  }

  u16(value: number): void {
    this.parts.push(value & 0xff, (value >>> 8) & 0xff);
  }

  u32(value: number): void {
    this.parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  bytes(data: Uint8Array): void {
    for (const byte of data) this.parts.push(byte);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

const encoder = new TextEncoder();

export function createZip(entries: ZipEntry[]): Blob {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const writer = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = writer.length;
    writer.u32(0x04034b50);
    writer.u16(20);
    writer.u16(0x0800);
    writer.u16(0);
    writer.u16(dosTime);
    writer.u16(dosDate);
    writer.u32(crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(name.length);
    writer.u16(0);
    writer.bytes(name);
    writer.bytes(entry.data);
    central.push({ name, crc, size: entry.data.length, offset });
  }

  const centralOffset = writer.length;
  for (const item of central) {
    writer.u32(0x02014b50);
    writer.u16(20);
    writer.u16(20);
    writer.u16(0x0800);
    writer.u16(0);
    writer.u16(dosTime);
    writer.u16(dosDate);
    writer.u32(item.crc);
    writer.u32(item.size);
    writer.u32(item.size);
    writer.u16(item.name.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(item.offset);
    writer.bytes(item.name);
  }

  const centralSize = writer.length - centralOffset;
  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralOffset);
  writer.u16(0);

  const bytes = writer.finish();
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([data], { type: 'application/zip' });
}
