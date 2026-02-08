# FlodJS - TypeScript Version

A complete TypeScript rewrite of FlodJS 2.1, a JavaScript MOD/XM/IT file player for the Web Audio API.

## Features

- Pure TypeScript implementation
- Type-safe audio handling
- Support for multiple tracker file formats (MOD, XM, IT, etc.)
- Modern ES6+ architecture
- Easy-to-use API
- Full compatibility with Web Audio API

## Installation

This library is included in the harmoneasy project at `source/libs/flodjs/`

## Usage

### Basic Usage

```typescript
import FlodJS from './libs/flodjs';

const player = new FlodJS();

// Load a tracker file
const file = await fetch('myfile.mod').then(r => r.arrayBuffer());
const version = player.load(file);

if (version > 0) {
  console.log(`Loaded: ${player.getTitle()}`);
  console.log(`Channels: ${player.getChannels()}`);
  console.log(`Format: ${player.getTrackerFormat()?.name}`);
  
  player.play();
}
```

### API

#### Constructor

```typescript
const player = new FlodJS();
```

#### Methods

- **load(data: ArrayBuffer): number** - Load a tracker file. Returns version number if successful.
- **play(): void** - Start playback.
- **pause(): void** - Pause playback.
- **stop(): void** - Stop playback.
- **reset(): void** - Reset player state.
- **toggleChannel(index: number): void** - Toggle mute for a specific channel.
- **setVolume(value: number): void** - Set volume (0.0 to 1.0).
- **setQuality(value: number): void** - Set quality (0 = fast, 1 = accurate).
- **getTrackerFormat(): { name: string; format: number } | null** - Get current tracker format.
- **getTitle(): string** - Get the song title.
- **getChannels(): number** - Get the number of channels.
- **isPlaying(): boolean** - Check if currently playing.
- **isPaused(): boolean** - Check if paused.

## Architecture

### Modules

- **types.ts** - TypeScript interfaces and enums
- **ByteStream.ts** - Binary data reading/writing utilities
- **CoreMixer.ts** - Base mixer implementation
- **CorePlayer.ts** - Base player implementation
- **Soundblaster.ts** - SoundBlaster channel and mixer implementation
- **FileLoader.ts** - File format detection and loading
- **index.ts** - Main player class and exports

### Core Components

#### ByteStream
Handles reading binary data from ArrayBuffers with support for little-endian and big-endian formats.

#### CoreMixer
Base mixer that manages audio channels and samples, handling the mixing of audio data.

#### CorePlayer
Base player providing core functionality: loading, playing, pausing, stopping audio files.

#### SoundBlaster
Implements the SoundBlaster channel format with support for:
- 8-bit and 16-bit samples
- Loop modes (forward, ping-pong)
- Volume and panning control
- Fast and accurate mixing modes

#### FileLoader
Detects and loads various tracker file formats by examining file signatures and headers.

## Events

The player dispatches custom events:

- **flodPlay** - Fired when playback starts
- **flodPause** - Fired when playback is paused
- **flodStop** - Fired when playback stops

Example:

```typescript
window.addEventListener('flodPlay', () => {
  console.log('Playback started');
});
```

## Supported Formats

- Ultimate SoundTracker
- SoundTracker variants (2.3, 2.4)
- NoiseTracker (1.0, 1.1, 2.0)
- ProTracker (1.0, 1.1, 1.2, 2.0, 2.1)
- His Master's NoiseTracker
- SoundFX (multiple versions)
- BP SoundMon (V1, V2, V3)
- Delta Music (1.0, 2.0)
- Digital Mugician
- Future Composer
- SidMon
- David Whittaker
- FredEd
- Jochen Hippel
- Rob Hubbard
- FastTracker II
- Sk@leTracker
- MadTracker 2.0
- MilkyTracker
- DigiBooster Pro
- OpenMPT

## Browser Compatibility

Requires a modern browser with Web Audio API support:
- Chrome 14+
- Firefox 25+
- Safari 6+
- Edge 12+

## License

This work is licensed under the Creative Commons Attribution-Noncommercial-Share Alike 3.0 Unported License.

Based on the original FlodJS 2.1 by Christian Corti.

## References

- Original FlodJS: https://github.com/photonstorm/FlodJS
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
