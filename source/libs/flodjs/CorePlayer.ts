import type { PlayerBase, MixerInfo, ByteStream } from './types';
import { createByteStream } from './ByteStream';
import { createCoreMixer } from './CoreMixer';

/**
 * CorePlayer - Base player class providing core audio playback functionality
 */
export function createCorePlayer(mixer?: MixerInfo): Partial<PlayerBase> & { mixer: MixerInfo } {
  let audioContext: AudioContext | null = null;

  if (typeof window !== 'undefined' && (window as any).neoart?.audioContext) {
    audioContext = (window as any).neoart.audioContext as AudioContext;
  } else if (typeof AudioContext !== 'undefined') {
    audioContext = new AudioContext();
  } else if (typeof (window as any).webkitAudioContext !== 'undefined') {
    audioContext = new (window as any).webkitAudioContext();
  }

  if (!audioContext) {
    throw new Error('AudioContext not available');
  }

  // Store audio context globally
  if (typeof window !== 'undefined') {
    if (!(window as any).neoart) {
      (window as any).neoart = {};
    }
    (window as any).neoart.audioContext = audioContext;
  }

  const mixerInstance = mixer || createCoreMixer();

  const player: Partial<PlayerBase> & { mixer: MixerInfo } = {
    context: audioContext,
    node: null,
    analyse: 0,
    endian: 0,
    sampleRate: audioContext.sampleRate,
    playSong: 0,
    lastSong: 0,
    version: 0,
    title: '',
    channels: 0,
    loopSong: 0,
    speed: 0,
    tempo: 0,
    mixer: mixerInstance,
    tick: 0,
    paused: 0,
    callback: null,

    set quality(value: number) {
      if (value) {
        this.callback = (e: AudioProcessingEvent) => {
          if ('accurate' in this && typeof this.accurate === 'function') {
            (this.accurate as (e: AudioProcessingEvent) => void).call(this, e);
          }
        };
      } else {
        this.callback = (e: AudioProcessingEvent) => {
          if ('fast' in this && typeof this.fast === 'function') {
            (this.fast as (e: AudioProcessingEvent) => void).call(this, e);
          }
        };
      }
    },

    toggle(index: number): void {
      if (this.mixer.channels && this.mixer.channels[index]) {
        this.mixer.channels[index].mute ^= 1;
      }
    },

    setup(): void {
      // Base implementation - overridden in subclasses
    },

    load(stream: ByteStream | ArrayBuffer): number {
      this.version = 0;
      this.playSong = 0;
      this.lastSong = 0;

      this.mixer.restore();

      let byteStream: ByteStream;
      if (stream instanceof ArrayBuffer) {
        byteStream = createByteStream(stream);
      } else {
        byteStream = stream;
      }

      byteStream.position = 0;

      // Check for ZIP file
      if (byteStream.readUint() === 67324752) {
        // ZIP magic number
        if (typeof window !== 'undefined' && (window as any).neoart?.Unzip) {
          const ZipFile = (window as any).neoart.ZipFile;
          const zip = ZipFile(byteStream);
          byteStream = zip.uncompress(zip.entries[0]);
        } else {
          throw new Error('Unzip support is not available.');
        }
      }

      if (byteStream) {
        byteStream.endian = this.endian || 0;
        byteStream.position = 0;

        if ('loader' in this) {
          (this as PlayerBase).loader(byteStream);
        }
      }

      if (this.version) {
        this.setup?.();
      }

      return this.version || 0;
    },

    play(): void {
      if (!this.version) return;

      if (this.paused) {
        this.paused = 0;
      } else {
        if ('initialize' in this) {
          (this as PlayerBase).initialize();
        }
        if (this.context) {
          this.node = this.context.createScriptProcessor(this.mixer.bufferSize, 0, 2);
          if (this.callback && this.node) {
            this.node.onaudioprocess = this.callback;
          }
        }
      }

      let analyserNode: AnalyserNode | null = null;
      if (this.analyse && this.context) {
        analyserNode = this.context.createAnalyser();
        if (this.node) {
          this.node.connect(analyserNode);
        }
        analyserNode.connect(this.context.destination);
      } else if (this.node && this.context) {
        this.node.connect(this.context.destination);
      }

      if (typeof window !== 'undefined') {
        if ((window as any).neoart?.Flectrum && analyserNode) {
          (window as any).neoart.analyserNode = analyserNode;
        }
      }

      const event = new Event('flodPlay', { bubbles: true });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(event);
      }
    },

    pause(): void {
      if (this.node) {
        this.node.disconnect();
        this.paused = 1;

        const event = new Event('flodPause', { bubbles: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(event);
        }
      }
    },

    stop(): void {
      if (this.node) {
        this.node.disconnect();
        this.node.onaudioprocess = null;
        this.node = null;
        this.paused = 0;

        if ('restore' in this && typeof this.restore === 'function') {
          (this.restore as () => void).call(this);
        }

        const event = new Event('flodStop', { bubbles: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(event);
        }
      }
    },

    reset(): void {
      this.tick = 0;
      if ('initialize' in this) {
        (this.mixer as any).initialize();
      }
      if (this.sampleRate && this.tempo) {
        this.mixer.samplesTick =
          ((this.sampleRate * 2.5) / this.tempo) >> 0;
      }
    },
  };

  // Set initial mixer player reference
  mixerInstance.player = player as PlayerBase;

  return player;
}
