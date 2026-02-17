# HarmonEasy

> A web-based music collaboration platform that transforms, quantizes, and harmonizes live MIDI input in real-time

## Overview

HarmonEasy is a modern web application for collaborative music-making with friends. It combines MIDI input from multiple sources (keyboards, controllers, Bluetooth devices), applies real-time audio transformations, and outputs synchronized audio with harmonic and temporal adjustments.

**Tagline:** *Putting the Unity in Community*

## Features

- **Multiple Input Sources**
  - WebMIDI device support
  - Bluetooth MIDI (BLE) connectivity
  - On-screen keyboard
  - Gamepad support
  - Microphone input with formant analysis

- **Real-Time Audio Processing**
  - Web Audio API synthesis
  - WAM2 (Web Audio Modules 2) plugin support
  - Polyphonic synthesis with multiple instrument types
  - Pitch tracking and formant analysis

- **Transformers Pipeline**
  - Quantization to scales/modes
  - Transposition and harmonization
  - Chord generation (Chordifier)
  - Arpeggiator
  - Note delay/repeater/shortener
  - Microtonality support
  - Humanization (swing, timing variations)
  - Randomization
  - Emoji-based mood chords (Moodifier)
  - and more...

- **Music Theory Integration**
  - Scale and mode support (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian)
  - Chord recognition and generation
  - Microtuning systems (EDO scales)
  - Interval-based transformations

- **Export Capabilities**
  - MIDI file export (.mid)
  - MusicXML export
  - Markdown notation export
  - Sheet music visualization (VexFlow)
  - AudioTool integration
  - OpenDAW project export
  - .dawProject format support

- **Persistent Storage**
  - OPFS (Origin Private File System) support
  - Session recording and playback
  - Real-time command recording

- **Visualization**
  - Song timeline visualization
  - Note activity monitor
  - On-screen keyboard display
  - Real-time waveform display

## Tech Stack

- **Frontend:** TypeScript, Vite, Web Components
- **Audio:** Web Audio API, MIDI.js, WAM2
- **State Management:** Custom state system with history API
- **Styling:** SCSS
- **Bundler:** Vite
- **Testing:** Vitest
- **Runtime:** Electron (optional), Browser

## Prerequisites

- **Node.js:** 18.x or higher
- **pnpm:** 8.x or higher (package manager)
- **Modern Browser:** Chrome 90+, Firefox 88+, Safari 14.1+ (for Web Audio support)
- **WebMIDI Support:** Required for MIDI device input

## Installation

```bash
# Clone the repository
git clone https://github.com/designerzen/harmoneasy.git
cd harmoneasy

# Install dependencies
pnpm install

# Start development server
pnpm run dev
```

The development server will start on `http://localhost:5174` by default.

## Development

### Available Commands

```bash
# Start development server
pnpm run dev

# Build for production
pnpm run build

# Preview production build locally
pnpm run preview

# Run tests
pnpm test

# Watch for file changes in test mode
pnpm test -- --watch
```

### Project Structure

```
source/
├── assets/              # Images, logos, styles
├── components/          # UI components (keyboard, visualizers)
├── libs/
│   ├── audiobus/       # Core audio engine
│   │   ├── instruments/     # Synth instruments, oscillators
│   │   ├── io/              # Input/output devices and transformers
│   │   ├── midi/            # MIDI protocol and BLE support
│   │   ├── timing/          # Audio timing and synchronization
│   │   ├── tuning/          # Music theory (scales, intervals, chords)
│   │   ├── conversion/      # Note/frequency conversions
│   │   └── storage/         # OPFS file system storage
│   ├── midi-ble/        # Bluetooth MIDI implementation
│   ├── pitfalls/        # Music theory utilities (EDO scales, intervals)
│   ├── audiotool/       # AudioTool SDK integration
│   ├── openDAW/         # OpenDAW integration
│   └── state.ts         # Global state management
├── hooks/               # React/custom hooks
├── electron/            # Electron main process (if building desktop)
├── index.ts            # Application entry point
├── ui.ts               # UI controller class
├── audio.ts            # Audio engine initialization
├── commands.ts         # MIDI command constants
└── options.ts          # Configuration options
```

### Key Architecture Components

#### AudioCommand
The fundamental unit representing a musical event. Extends from `IAudioCommand` interface with support for note on/off, control changes, pitch bend, etc.

#### InputFactory
Factory pattern for dynamically creating audio input instances with lazy-loading support. Provides a registry of available inputs (Keyboard, GamePad, WebMIDI, BLE MIDI, Microphone, etc.) with availability detection and async instantiation.

```typescript
import { createInputById, getAvailableInputFactories } from './libs/audiobus/io/input-factory.ts'
import * as INPUT_TYPES from './libs/audiobus/io/inputs/input-types.ts'

// Create a specific input
const keyboard = await createInputById(INPUT_TYPES.KEYBOARD)

// Get all available inputs for current environment
const availableInputs = getAvailableInputFactories()
```

#### OutputFactory
Factory pattern for dynamically creating audio output instances with lazy-loading support. Provides a registry of available outputs (Notation, Spectrum Analyser, Pink Trombone, WebMIDI, Speech Synthesis, etc.) with async instantiation.

```typescript
import { createOutputById, getAvailableOutputFactories } from './libs/audiobus/io/output-factory.ts'
import * as OUTPUT_TYPES from './libs/audiobus/io/outputs/output-types.ts'

// Create a specific output
const notation = await createOutputById(OUTPUT_TYPES.NOTATION)

// Get all available outputs for current environment
const availableOutputs = getAvailableOutputFactories()
```

#### Transformer
Abstract class for processing audio commands in the pipeline. Each transformer implements a specific effect (quantize, transpose, etc.).

#### TransformerManagerWorker
Manages the transformer pipeline with Web Worker support for non-blocking processing. Provides automatic fallback to main thread if workers unavailable.

#### MIDIDevice
Abstraction for MIDI input/output devices. Handles device enumeration, MIDI event parsing, and message routing.

#### OutputWAM2
Implements IAudioOutput interface for Web Audio Modules 2 plugin support. Handles plugin lifecycle, MIDI routing, and audio processing.

#### WAM2Host
Plugin registry and discovery system. Manages WAM2 plugin instances, metadata, and initialization.

### Code Style Guidelines

- **Imports:** Always include `.ts` or `.js` extensions
- **Types:** Strict TypeScript - use explicit types, avoid `any`
- **Naming:** `camelCase` for variables/functions, `PascalCase` for classes/types
- **Comments:** JSDoc for public APIs
- **Error Handling:** Validate at boundaries, trust internal code
- **Module System:** ES modules only

## Building

### Production Build

```bash
pnpm run build
```

Output will be in the `build/` directory, ready for deployment.

### Desktop Build (Electron)

```bash
pnpm run build:electron
```

Creates platform-specific executable in `native/` directory.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACE                        │
│  (Keyboard, Visualizers, Controls, File Management)     │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                   IO CHAIN                              │
│  (InputManager → TransformerManager → OutputManager)   │
└────────────────────┬────────────────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
┌────▼──┐    ┌──────▼──────┐  ┌────▼──────┐
│ Inputs │    │ Transformers│  │  Outputs  │
├────────┤    ├─────────────┤  ├───────────┤
│ MIDI   │    │ Quantize    │  │ Web Audio │
│ BLE    │    │ Transpose   │  │ MIDI Out  │
│ Kbd    │    │ Harmonize   │  │ WAM2      │
│ Mic    │    │ Chord       │  │ Notation  │
│        │    │ Arpeggio    │  │ Speech    │
│        │    │ ...         │  │ Vibrator  │
└────────┘    └─────────────┘  └───────────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
        ┌────────────▼────────────┐
        │   Audio Clock / Timer   │
        │   (Synchronization)     │
        └─────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │   Event Recorder        │
        │   (OPFS Storage)        │
        └─────────────────────────┘
```

## Usage

### Basic Setup

1. **Grant Permissions:** Allow WebMIDI and/or Bluetooth access when prompted
2. **Connect Devices:** Select MIDI input/output devices from sidebar
3. **Select Scale:** Choose a scale and root note for quantization
4. **Play:** Start playing on your MIDI device - notes will be quantized and harmonized in real-time
5. **Export:** Use Export menu to save as MIDI, MusicXML, or other formats

### Volume Control

Use the volume slider in the header, or use the volume up/down buttons for quick adjustments (±5% per click).

### Transformers

Apply transformers to the audio pipeline:
- Drag transformers from sidebar to add them
- Reorder by dragging
- Configure parameters in transformer properties
- Enable/disable individual transformers

### Recording & Playback

- All commands are automatically recorded
- Session data is persisted in browser storage
- Export recordings in multiple formats
- Import MIDI files to add to your session

## WAM2 (Web Audio Modules 2) Support

HarmonEasy includes native WAM2 plugin support via the OutputFactory:

```typescript
import { createOutputById } from './libs/audiobus/io/output-factory.ts'
import * as OUTPUT_TYPES from './libs/audiobus/io/outputs/output-types.ts'

// Create WAM2 output using factory
const wam2Output = await createOutputById(OUTPUT_TYPES.WAM2)

// Route MIDI to plugin
await wam2Output.noteOn(60, 100)
await wam2Output.noteOff(60)
```

See [WAM2_AUDIO_OUTPUT.md](WAM2_AUDIO_OUTPUT.md) for complete WAM2 documentation.

## Browser Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 90+ | ✅ Full |
| Firefox | 88+ | ✅ Full |
| Safari | 14.1+ | ✅ Full |
| Edge | 90+ | ✅ Full |

**Requirements:**
- Web Audio API
- Web MIDI API (optional, for MIDI devices)
- Web Bluetooth API (optional, for Bluetooth MIDI)
- OPFS (optional, for persistent storage)

## Known Limitations

- WebMIDI is not available in private/incognito browsing
- Bluetooth MIDI requires HTTPS in production
- Some transformers may not work with certain audio contexts
- WAM2 plugin availability varies by browser

## API Documentation

### Audio Command Format

```typescript
interface IAudioCommand {
  timestamp: number           // When to execute
  command: number             // MIDI status (144 = note on, etc)
  channel: number             // MIDI channel (1-16)
  note: number                // Note number (0-127)
  velocity: number            // Velocity (0-127)
  duration?: number           // Note duration in seconds
  customData?: Record<any, any> // Additional metadata
}
```

### Transformer Interface

```typescript
interface ITransformer {
  transform(commands: IAudioCommand[], timer: Timer): Promise<IAudioCommand[]>
  name: string
  description: string
  defaultConfig: Record<string, any>
}
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write tests for new features
- Follow the code style guidelines in AGENTS.md
- Update documentation for API changes
- Ensure all tests pass before submitting PR

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Web Audio API](https://www.w3.org/TR/webaudio/)
- [Web MIDI API](https://www.w3.org/TR/webmidi/)
- [Web Audio Modules 2](https://www.webaudiomodules.org/)
- [VexFlow](https://www.vexflow.com/) for sheet music rendering
- [Pink Trombone](https://dood.al/pinktrombone/) for speech synthesis

## Support

For issues, questions, or suggestions:

- 📝 Open an [issue](https://github.com/designerzen/harmoneasy/issues)
- 💬 Start a [discussion](https://github.com/designerzen/harmoneasy/discussions)
- 📧 Contact the maintainers

## Roadmap

- [ ] Collaborative real-time editing (PartyKit integration)
- [ ] User accounts and cloud sync
- [ ] More WAM2 plugins
- [ ] VST/AU plugin wrappers
- [ ] Mobile app (React Native)
- [ ] Advanced MIDI learn/mapping
- [ ] Preset system for transformer chains
- [ ] Performance improvements (WASM transformers)

---

**Made with ♪ by the HarmonEasy community**
