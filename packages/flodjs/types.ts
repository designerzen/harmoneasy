/**
 * FlodJS - TypeScript Version
 * A JavaScript MOD/XM/IT file player for the Web Audio API
 * 
 * Based on the original FlodJS 2.1 by Christian Corti
 * TypeScript conversion with modern ES6+ features
 */

export enum Endian {
  LITTLE = 1,
  BIG = 0,
}

export interface SampleData {
  l: number;
  r: number;
  next: SampleData | null;
}

export interface ChannelData {
  next: ChannelData | null;
  mute: number;
  enabled: number;
  sample: SampleInfo | null;
  length: number;
  index: number;
  pointer: number;
  delta: number;
  fraction: number;
  speed: number;
  dir: number;
  oldSample: SampleInfo | null;
  oldLength: number;
  oldPointer: number;
  oldFraction: number;
  oldSpeed: number;
  oldDir: number;
  volume: number;
  lvol: number;
  rvol: number;
  panning: number;
  lpan: number;
  rpan: number;
  ldata: number;
  rdata: number;
  mixCounter: number;
  lmixRampU: number;
  lmixDeltaU: number;
  rmixRampU: number;
  rmixDeltaU: number;
  lmixRampD: number;
  lmixDeltaD: number;
  rmixRampD: number;
  rmixDeltaD: number;
  volCounter: number;
  lvolDelta: number;
  rvolDelta: number;
  panCounter: number;
  lpanDelta: number;
  rpanDelta: number;
  initialize(): void;
}

export interface SampleInfo {
  name: string;
  bits: number;
  volume: number;
  length: number;
  data: Float32Array;
  loopMode: number;
  loopStart: number;
  loopLen: number;
  store(stream: ByteStream): void;
}

export interface MixerInfo {
  player: PlayerBase | null;
  channels: ChannelData[];
  buffer: SampleData[];
  samplesTick: number;
  samplesLeft: number;
  remains: number;
  completed: number;
  bufferSize: number;
  reset(): void;
  restore(): void;
}

export interface PlayerBase {
  context: AudioContext;
  node: ScriptProcessorNode | null;
  analyse: number;
  endian: number;
  sampleRate: number;
  playSong: number;
  lastSong: number;
  version: number;
  title: string;
  channels: number;
  loopSong: number;
  speed: number;
  tempo: number;
  mixer: MixerInfo;
  tick: number;
  paused: number;
  callback: ((e: AudioProcessingEvent) => void) | null;
  quality: number;
  toggle(index: number): void;
  setup(): void;
  load(stream: ByteStream): number;
  play(): void;
  pause(): void;
  stop(): void;
  reset(): void;
  initialize(): void;
  process(): void;
  loader(stream: ByteStream): void;
  restore?(): void;
  fast?(): void;
  accurate?(): void;
}

export interface ByteStream {
  endian: number;
  length: number;
  index: number;
  buffer: ArrayBuffer;
  view: DataView | null;
  bytesAvailable: number;
  position: number;
  clear(): void;
  readAt(index: number): number;
  readByte(): number;
  readShort(): number;
  readInt(): number;
  readUbyte(): number;
  readUshort(): number;
  readUint(): number;
  readBytes(buffer: ByteStream, offset: number, len: number): void;
  readString(len: number): string;
  writeAt(index: number, value: number): void;
  writeByte(value: number): void;
  writeShort(value: number): void;
  writeInt(value: number): void;
}

export interface TrackerInfo {
  name: string;
  format: number;
}

export enum TrackerFormat {
  UNKNOWN = 0,
  ULTIMATE = 1,
  DOC_9 = 2,
  MASTER = 3,
  DOC_20 = 4,
  ST_23 = 5,
  ST_24 = 6,
  NT_10 = 7,
  NT_11 = 8,
  NT_20 = 9,
  PT_10 = 10,
  PT_11 = 11,
  PT_12 = 12,
  HISMASTER = 13,
  SFX_10 = 14,
  SFX_18 = 15,
  SFX_1945 = 16,
  SFX_194 = 17,
  BP_V1 = 18,
  BP_V2 = 19,
  BP_V3 = 20,
  DELTA_10 = 21,
  DELTA_20 = 22,
  DIGITAL_MUG = 23,
  DIGITAL_MUG_7 = 24,
  FC_13 = 25,
  FC_14 = 26,
  SIDMON_10 = 27,
  SIDMON_20 = 28,
  WHITTAKER = 29,
  FREDED = 30,
  HIPPEL = 31,
  HIPPEL_COSO = 32,
  HUBBARD = 33,
  FASTTRACKER = 34,
  SKALETRACKER = 35,
  MADTRACKER = 36,
  MILKYTRACKER = 37,
  DIGIBOOSTER = 38,
  OPENMPT = 39,
}
