import type { ByteStream } from './types';
import { Endian } from './types';

/**
 * ByteStream - A utility class for reading and writing binary data
 * Provides methods for reading various data types from an ArrayBuffer
 */
export class ByteStreamImpl implements ByteStream {
  endian: number = Endian.LITTLE;
  length: number = 0;
  index: number = 0;
  buffer: ArrayBuffer;
  view: DataView | null = null;

  constructor(stream: ArrayBuffer, endian: number = Endian.LITTLE) {
    this.buffer = stream;
    this.view = new DataView(stream);
    this.length = stream.byteLength;
    this.endian = endian;
  }

  get bytesAvailable(): number {
    return this.length - this.index;
  }

  get position(): number {
    return this.index;
  }

  set position(value: number) {
    if (value < 0) {
      this.index = 0;
    } else if (value > this.length) {
      this.index = this.length;
    } else {
      this.index = value;
    }
  }

  clear(): void {
    this.buffer = new ArrayBuffer(0);
    this.view = null;
    this.index = 0;
    this.length = 0;
  }

  readAt(index: number): number {
    if (!this.view) throw new Error('DataView is null');
    return this.view.getUint8(index);
  }

  readByte(): number {
    if (!this.view) throw new Error('DataView is null');
    return this.view.getInt8(this.index++);
  }

  readShort(): number {
    if (!this.view) throw new Error('DataView is null');
    const r = this.view.getInt16(this.index, this.endian === Endian.LITTLE);
    this.index += 2;
    return r;
  }

  readInt(): number {
    if (!this.view) throw new Error('DataView is null');
    const r = this.view.getInt32(this.index, this.endian === Endian.LITTLE);
    this.index += 4;
    return r;
  }

  readUbyte(): number {
    if (!this.view) throw new Error('DataView is null');
    return this.view.getUint8(this.index++);
  }

  readUshort(): number {
    if (!this.view) throw new Error('DataView is null');
    const r = this.view.getUint16(this.index, this.endian === Endian.LITTLE);
    this.index += 2;
    return r;
  }

  readUint(): number {
    if (!this.view) throw new Error('DataView is null');
    const r = this.view.getUint32(this.index, this.endian === Endian.LITTLE);
    this.index += 4;
    return r;
  }

  readBytes(buffer: ByteStream, offset: number, len: number): void {
    if (!this.view || !buffer.view) {
      throw new Error('DataView is null');
    }

    const dst = buffer.view;
    let i = this.index;
    const src = this.view;
    let endLen = len + i;

    if (endLen > this.length) {
      endLen = this.length;
    }

    for (; i < endLen; ++i) {
      dst.setUint8(offset++, src.getUint8(i));
    }

    this.index = i;
  }

  readString(len: number): string {
    if (!this.view) throw new Error('DataView is null');

    let i = this.index;
    const src = this.view;
    let text = '';
    let endLen = len + i;

    if (endLen > this.length) {
      endLen = this.length;
    }

    for (; i < endLen; ++i) {
      text += String.fromCharCode(src.getUint8(i));
    }

    this.index = endLen;
    return text;
  }

  writeAt(index: number, value: number): void {
    if (!this.view) throw new Error('DataView is null');
    this.view.setUint8(index, value);
  }

  writeByte(value: number): void {
    if (!this.view) throw new Error('DataView is null');
    this.view.setInt8(this.index++, value);
  }

  writeShort(value: number): void {
    if (!this.view) throw new Error('DataView is null');
    this.view.setInt16(this.index, value, this.endian === Endian.LITTLE);
    this.index += 2;
  }

  writeInt(value: number): void {
    if (!this.view) throw new Error('DataView is null');
    this.view.setInt32(this.index, value, this.endian === Endian.LITTLE);
    this.index += 4;
  }
}

export function createByteStream(
  stream: ArrayBuffer | ByteStream,
  endian: number = Endian.LITTLE
): ByteStreamImpl {
  if (stream instanceof ArrayBuffer) {
    return new ByteStreamImpl(stream, endian);
  }

  // If it's already a ByteStream, create a new one from its buffer
  const impl = stream as unknown as ByteStreamImpl;
  const newStream = new ByteStreamImpl(impl.buffer, endian);
  newStream.view = impl.view;
  return newStream;
}
