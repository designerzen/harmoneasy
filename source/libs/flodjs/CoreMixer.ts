import type { SampleData, MixerInfo, ChannelData, PlayerBase } from './types';

/**
 * Sample - Represents a single audio sample with left and right channels
 */
export function createSample(): SampleData {
  return {
    l: 0.0,
    r: 0.0,
    next: null,
  };
}

/**
 * CoreMixer - Base mixer class for audio processing
 */
export function createCoreMixer(player: PlayerBase | null = null): MixerInfo {
  const mixer: MixerInfo = {
    player,
    channels: [],
    buffer: [],
    samplesTick: 0,
    samplesLeft: 0,
    remains: 0,
    completed: 0,
    bufferSize: 8192,

    reset(): void {
      const chan = this.channels[0];
      const sample = this.buffer[0];
      this.samplesLeft = 0;
      this.remains = 0;
      this.completed = 0;

      let currentChan: ChannelData | null = chan || null;
      while (currentChan) {
        currentChan.initialize();
        currentChan = currentChan.next;
      }

      let currentSample: SampleData | null = sample || null;
      while (currentSample) {
        currentSample.l = 0.0;
        currentSample.r = 0.0;
        currentSample = currentSample.next;
      }
    },

    restore(): void {
      // Base implementation - overridden in subclasses
    },
  };

  // Set up buffer with initial sample
  const initialSample = createSample();
  mixer.buffer[0] = initialSample;

  let previousSample = initialSample;
  for (let i = 1; i < mixer.bufferSize; i++) {
    const sample = createSample();
    previousSample.next = sample;
    mixer.buffer[i] = sample;
    previousSample = sample;
  }

  return mixer;
}

export function setMixerBufferSize(mixer: MixerInfo, value: number): void {
  const currentLen = mixer.buffer.length || 0;
  if (value === currentLen || value < 512) {
    return;
  }

  mixer.buffer.length = value;

  if (value > currentLen) {
    mixer.buffer[currentLen] = createSample();
    let previousSample = mixer.buffer[currentLen];

    for (let i = currentLen + 1; i < value; i++) {
      const sample = createSample();
      previousSample.next = sample;
      mixer.buffer[i] = sample;
      previousSample = sample;
    }
  }
}

export function setMixerComplete(
  mixer: MixerInfo,
  value: number,
  loopSong: number
): void {
  mixer.completed = value ^ loopSong;
}
