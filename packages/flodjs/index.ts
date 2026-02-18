/**
 * flodjs
 * FlodJS - TypeScript Version
 * A JavaScript MOD/XM/IT file player for the Web Audio API
 *
 * Based on the original FlodJS 2.1 by Christian Corti
 * TypeScript conversion with modern ES6+ features
 *
 * License: Creative Commons Attribution-Noncommercial-Share Alike 3.0 Unported
 * For more information visit: http://creativecommons.org/licenses/by-nc-sa/3.0/
 */

export type {
  Endian,
  SampleData,
  ChannelData,
  SampleInfo,
  MixerInfo,
  PlayerBase,
  ByteStream,
  TrackerInfo,
  TrackerFormat,
} from './types'

export {
  ByteStreamImpl,
  createByteStream,
} from './ByteStream'

export {
  createSample,
  createCoreMixer,
  setMixerBufferSize,
  setMixerComplete,
} from './CoreMixer'

export {
  createCorePlayer,
} from './CorePlayer'

export {
  createSBChannel,
  createSBSample,
  createSoundblasterMixer,
  createSBPlayer,
} from './Soundblaster'

export {
  FileLoader,
  createFileLoader,
  type TrackerFormat as FileTrackerFormat,
} from './FileLoader'

/**
 * FlodJS - Main player class
 * Usage:
 *
 * ```typescript
 * const player = new FlodJS();
 * const file = await fetch('myfile.mod').then(r => r.arrayBuffer());
 * player.load(file);
 * player.play();
 * ```
 */
export class FlodJS {
  private player: any;
  private fileLoader: any;

  constructor() {
    // Dynamic imports are handled at runtime
    // These will be loaded when needed
  }

  /**
   * Load a tracker file (MOD, XM, IT, etc.)
   * @param data - ArrayBuffer containing the tracker file data
   * @returns Version number if successful, 0 if failed
   */
  load(data: ArrayBuffer): number {
    try {
      const result = this.fileLoader.load(data);
      if (result && result.version) {
        this.player = result;
        return result.version;
      }
      return 0;
    } catch (e) {
      console.error('Failed to load file: ' + String(e));
      return 0;
    }
  }

  /**
   * Play the loaded track
   */
  play(): void {
    if (this.player && this.player.play) {
      this.player.play();
    }
  }

  /**
   * Pause the playback
   */
  pause(): void {
    if (this.player && this.player.pause) {
      this.player.pause();
    }
  }

  /**
   * Stop the playback
   */
  stop(): void {
    if (this.player && this.player.stop) {
      this.player.stop();
    }
  }

  /**
   * Reset the player state
   */
  reset(): void {
    if (this.player && this.player.reset) {
      this.player.reset();
    }
  }

  /**
   * Toggle mute for a channel
   * @param index - Channel index
   */
  toggleChannel(index: number): void {
    if (this.player && this.player.toggle) {
      this.player.toggle(index);
    }
  }

  /**
   * Set the volume (0.0 to 1.0)
   * @param value - Volume level
   */
  setVolume(value: number): void {
    if (this.player && this.player.setVolume) {
      this.player.setVolume(value);
    }
  }

  /**
   * Set the audio quality (0 = fast, 1 = accurate)
   * @param value - Quality level
   */
  setQuality(value: number): void {
    if (this.player) {
      this.player.quality = value;
    }
  }

  /**
   * Get the current tracker format
   * @returns Tracker format information
   */
  getTrackerFormat(): { name: string; format: number } | null {
    if (this.fileLoader && this.fileLoader.tracker) {
      return this.fileLoader.tracker;
    }
    return null;
  }

  /**
   * Get the song title
   * @returns Song title
   */
  getTitle(): string {
    if (this.player && this.player.title) {
      return this.player.title;
    }
    return '';
  }

  /**
   * Get the number of channels
   * @returns Number of channels
   */
  getChannels(): number {
    if (this.player && this.player.channels) {
      return this.player.channels;
    }
    return 0;
  }

  /**
   * Check if currently playing
   * @returns true if playing, false otherwise
   */
  isPlaying(): boolean {
    return this.player && this.player.node !== null && this.player.paused === 0;
  }

  /**
   * Check if paused
   * @returns true if paused, false otherwise
   */
  isPaused(): boolean {
    return this.player && this.player.paused === 1;
  }
}

export default FlodJS;

