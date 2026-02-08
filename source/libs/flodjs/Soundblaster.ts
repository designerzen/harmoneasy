import type { ChannelData, SampleInfo, PlayerBase, MixerInfo } from './types';
import type { ByteStream } from './types';
import { createCoreMixer } from './CoreMixer';
import { createCorePlayer } from './CorePlayer';

/**
 * SoundBlaster Channel - Represents a single audio channel
 */
export function createSBChannel(): ChannelData {
  return {
    next: null,
    mute: 0,
    enabled: 0,
    sample: null,
    length: 0,
    index: 0,
    pointer: 0,
    delta: 0,
    fraction: 0.0,
    speed: 0.0,
    dir: 0,
    oldSample: null,
    oldLength: 0,
    oldPointer: 0,
    oldFraction: 0.0,
    oldSpeed: 0.0,
    oldDir: 0,
    volume: 0.0,
    lvol: 0.0,
    rvol: 0.0,
    panning: 128,
    lpan: 0.5,
    rpan: 0.5,
    ldata: 0.0,
    rdata: 0.0,
    mixCounter: 0,
    lmixRampU: 0.0,
    lmixDeltaU: 0.0,
    rmixRampU: 0.0,
    rmixDeltaU: 0.0,
    lmixRampD: 0.0,
    lmixDeltaD: 0.0,
    rmixRampD: 0.0,
    rmixDeltaD: 0.0,
    volCounter: 0,
    lvolDelta: 0.0,
    rvolDelta: 0.0,
    panCounter: 0,
    lpanDelta: 0.0,
    rpanDelta: 0.0,

    initialize(): void {
      this.enabled = 0;
      this.sample = null;
      this.length = 0;
      this.index = 0;
      this.pointer = 0;
      this.delta = 0;
      this.fraction = 0.0;
      this.speed = 0.0;
      this.dir = 0;
      this.oldSample = null;
      this.oldLength = 0;
      this.oldPointer = 0;
      this.oldFraction = 0.0;
      this.oldSpeed = 0.0;
      this.oldDir = 0;
      this.volume = 0.0;
      this.lvol = 0.0;
      this.rvol = 0.0;
      this.panning = 128;
      this.lpan = 0.5;
      this.rpan = 0.5;
      this.ldata = 0.0;
      this.rdata = 0.0;
      this.mixCounter = 0;
      this.lmixRampU = 0.0;
      this.lmixDeltaU = 0.0;
      this.rmixRampU = 0.0;
      this.rmixDeltaU = 0.0;
      this.lmixRampD = 0.0;
      this.lmixDeltaD = 0.0;
      this.rmixRampD = 0.0;
      this.rmixDeltaD = 0.0;
      this.volCounter = 0;
      this.lvolDelta = 0.0;
      this.rvolDelta = 0.0;
      this.panCounter = 0;
      this.lpanDelta = 0.0;
      this.rpanDelta = 0.0;
    },
  };
}

/**
 * SoundBlaster Sample - Represents audio sample data
 */
export function createSBSample(): SampleInfo {
  return {
    name: '',
    bits: 8,
    volume: 0,
    length: 0,
    data: new Float32Array(0),
    loopMode: 0,
    loopStart: 0,
    loopLen: 0,

    store(stream: ByteStream): void {
      let delta = 0;
      let len = this.length;
      const pos = stream.position;

      if (!this.loopLen) {
        this.loopMode = 0;
      }

      if (this.loopMode) {
        len = this.loopStart + this.loopLen;
        this.data = new Float32Array(len + 1);
      } else {
        this.data = new Float32Array(this.length + 1);
      }

      if (this.bits === 8) {
        let total = pos + len;

        if (total > stream.length) {
          len = stream.length - pos;
        }

        for (let i = 0; i < len; i++) {
          let value = stream.readByte() + delta;

          if (value < -128) {
            value += 256;
          } else if (value > 127) {
            value -= 256;
          }

          this.data[i] = value * 0.0078125;
          delta = value;
        }
      } else {
        let total = pos + (len << 1);

        if (total > stream.length) {
          len = (stream.length - pos) >> 1;
        }

        for (let i = 0; i < len; i++) {
          let value = stream.readShort() + delta;

          if (value < -32768) {
            value += 65536;
          } else if (value > 32767) {
            value -= 65536;
          }

          this.data[i] = value * 0.00003051758;
          delta = value;
        }
      }

      if (!this.loopMode) {
        this.data[this.length] = 0.0;
      } else {
        this.length = this.loopStart + this.loopLen;

        if (this.loopMode === 1) {
          this.data[len] = this.data[this.loopStart];
        } else {
          this.data[len] = this.data[len - 1];
        }
      }

      if (len !== this.length) {
        const sample = this.data[len - 1];
        for (let i = len; i < this.length; i++) {
          this.data[i] = sample;
        }
      }
    },
  };
}

/**
 * Soundblaster Mixer - Handles audio mixing for SoundBlaster format
 */
export function createSoundblasterMixer(
  player: PlayerBase | null = null
): MixerInfo & {
  setup(len: number): void;
  initialize(): void;
  fast(e: AudioProcessingEvent): void;
  accurate(e: AudioProcessingEvent): void;
} {
  const mixer = createCoreMixer(player) as MixerInfo & {
    setup(len: number): void;
    initialize(): void;
    fast(e: AudioProcessingEvent): void;
    accurate(e: AudioProcessingEvent): void;
  };

  mixer.bufferSize = 8192;

  mixer.setup = function (len: number) {
    this.channels.length = len;
    const firstChannel = createSBChannel();
    this.channels[0] = firstChannel;

    for (let i = 1; i < len; i++) {
      const channel = createSBChannel();
      const prevChannel = this.channels[i - 1] as ChannelData;
      prevChannel.next = channel;
      this.channels[i] = channel;
    }
  };

  mixer.initialize = function () {
    this.reset();
  };

  mixer.fast = function (e: AudioProcessingEvent) {
    let mixed = 0;
    let mixLen: number;
    let mixPos = 0;
    let size = this.bufferSize;

    if (this.completed) {
      if (!this.remains) {
        if (this.player) {
          this.player.stop();
        }
        return;
      }
      size = this.remains;
    }

    while (mixed < size) {
      if (!this.samplesLeft) {
        if (this.player) {
          (this.player as any).process?.();
          (this.player as any).fast?.();
        }
        this.samplesLeft = this.samplesTick;

        if (this.completed) {
          size = mixed + this.samplesTick;

          if (size > this.bufferSize) {
            this.remains = size - this.bufferSize;
            size = this.bufferSize;
          }
        }
      }

      let toMix = this.samplesLeft;
      if (mixed + toMix >= size) toMix = size - mixed;
      mixLen = mixPos + toMix;

      let chan: ChannelData | null = this.channels[0] || null;

      while (chan) {
        if (!chan.enabled) {
          chan = chan.next;
          continue;
        }

        const s = chan.sample;
        if (!s) {
          chan = chan.next;
          continue;
        }

        const d = s.data;
        let sample = this.buffer[mixPos] || this.buffer[0];

        for (let i = mixPos; i < mixLen; ++i) {
          if (chan.index !== chan.pointer) {
            if (chan.index >= chan.length) {
              if (!s.loopMode) {
                chan.enabled = 0;
                break;
              } else {
                chan.pointer = s.loopStart + (chan.index - chan.length);
                chan.length = s.length;

                if (s.loopMode === 2) {
                  if (!chan.dir) {
                    chan.dir = s.length + s.loopStart - 1;
                  } else {
                    chan.dir = 0;
                  }
                }
              }
            } else {
              chan.pointer = chan.index;
            }

            if (!chan.mute) {
              const value =
                !chan.dir ? d[chan.pointer] : d[chan.dir - chan.pointer];
              chan.ldata = value * chan.lvol;
              chan.rdata = value * chan.rvol;
            } else {
              chan.ldata = 0.0;
              chan.rdata = 0.0;
            }
          }

          chan.index = chan.pointer + chan.delta;

          if ((chan.fraction += chan.speed) >= 1.0) {
            chan.index++;
            chan.fraction--;
          }

          sample.l += chan.ldata;
          sample.r += chan.rdata;
          sample = sample.next || sample;
        }

        chan = chan.next;
      }

      mixPos = mixLen;
      mixed += toMix;
      this.samplesLeft -= toMix;
    }

    let sample = this.buffer[0];
    const ldata = e.outputBuffer.getChannelData(0);
    const rdata = e.outputBuffer.getChannelData(1);

    for (let i = 0; i < size; ++i) {
      if (sample.l > 1.0) {
        sample.l = 1.0;
      } else if (sample.l < -1.0) {
        sample.l = -1.0;
      }

      if (sample.r > 1.0) {
        sample.r = 1.0;
      } else if (sample.r < -1.0) {
        sample.r = -1.0;
      }

      ldata[i] = sample.l;
      rdata[i] = sample.r;

      sample.l = 0.0;
      sample.r = 0.0;
      sample = sample.next || sample;
    }
  };

  mixer.accurate = function (e: AudioProcessingEvent) {
    // Simplified accurate mixing - can be extended
    this.fast(e);
  };

  return mixer;
}

/**
 * SoundBlaster Player - Plays SoundBlaster format audio files
 */
export function createSBPlayer(
  mixer?: MixerInfo
): PlayerBase & {
  track: any;
  length: number;
  restart: number;
  timer: number;
  master: number;
  setVolume(value: number): void;
} {
  const basePlayer = createCorePlayer(mixer) as any;

  const sbMixer = mixer || createSoundblasterMixer(basePlayer);

  const player = basePlayer as PlayerBase & {
    track: any;
    length: number;
    restart: number;
    timer: number;
    master: number;
    setVolume(value: number): void;
  };

  player.track = null;
  player.length = 0;
  player.restart = 0;
  player.timer = 0;
  player.master = 0;

  player.mixer = sbMixer;
  sbMixer.player = player;

  player.endian = 1;

  player.setVolume = function (value: number) {
    if (value < 0.0) {
      value = 0.0;
    } else if (value > 1.0) {
      value = 1.0;
    }
    this.master = value * 64;
  };

  Object.defineProperty(player, 'setup', {
    configurable: false,
    value: function () {
      this.mixer.setup(this.channels);
    },
  });

  Object.defineProperty(player, 'quality', {
    set: function (value: number) {
      if (value) {
        this.callback = (e: AudioProcessingEvent) =>
          (sbMixer as any).accurate(e);
      } else {
        this.callback = (e: AudioProcessingEvent) =>
          (sbMixer as any).fast(e);
      }
    },
  });

  return player;
}
