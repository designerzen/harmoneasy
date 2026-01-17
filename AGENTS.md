# Agent Instructions for HarmonEasy Audio Tools

## Build/Test Commands
- `npm test` - Run all tests with Vitest
- `npm run dev` - Start Vite dev server on port 5174
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build

## Architecture
This is a web-based MIDI/audio application built with TypeScript, Vite, and Web Audio/MIDI APIs. Entry point: [source/index.ts](source/index.ts)

**Key Subsystems:**
- `source/libs/audiobus/` - Core audio engine (MIDI devices, instruments, timing, transformers, tuning)
  - `outputs/` - Audio output implementations (Web Audio, MIDI, WAM2, etc.)
- `source/libs/midi-ble/` - Bluetooth MIDI support (BLE connection, MIDI streaming)
- `source/libs/pitfalls/` - Music theory (scales, intervals, tuning systems)
- `source/libs/audiotool/` - Integration with Audiotool (@audiotool/nexus)
- `source/components/` - UI components (keyboard, visualizers, canvas)
- `source/libs/state.ts` - Application state management

**Key Classes:**
- [AudioCommand](source/libs/audiobus/audio-command.ts) - Musical events/commands
- [Transformer](source/libs/audiobus/transformers/abstract-transformer.ts) - Audio pipeline transformers
- [TransformerManagerWorker](source/libs/audiobus/transformers/transformer-manager-worker.ts) - Manages transformer pipeline with Web Worker support
- [MIDIDevice](source/libs/audiobus/midi/midi-device.ts) - MIDI device abstraction
- [OutputWAM2](source/libs/audiobus/outputs/output-wam2.ts) - Web Audio Modules 2 plugin integration
- [WAM2Host](source/libs/audiobus/outputs/wam2-host.ts) - WAM2 plugin registry and lifecycle management
- [WAM2Loader](source/libs/audiobus/outputs/wam2-loader.ts) - High-level WAM2 plugin loading API

## WAM2 (Web Audio Modules 2) Support
- **OutputWAM2** - Implements `IAudioOutput` interface for WAM2 plugins
- **WAM2Host** - Plugin registry and discovery with instance management
- **WAM2Loader** - High-level API for loading and managing plugins
- Supports MIDI note on/off, control changes, and generic MIDI messages
- Async plugin initialization with error handling and polyfill support
- See [WAM2_AUDIO_OUTPUT.md](WAM2_AUDIO_OUTPUT.md) for complete documentation

## Transform Processing
- **TransformerManagerWorker** - Delegates all `transform()` calls to Web Workers to avoid blocking main thread
- Transform operations are now **async** - returns `Promise<IAudioCommand[]>`
- Automatic fallback to main thread if Worker fails or times out (5s timeout)
- Worker pool architecture for parallel transformer execution
- See `source/libs/audiobus/transformers/transform-worker.ts` for Worker implementation

## Code Style
- **Imports:** Use `.ts`/`.js` extensions in all imports (required by Vite config)
- **Types:** Strict TypeScript enabled - use explicit types, avoid `any`
- **Naming:** camelCase for variables/functions, PascalCase for classes/types
- **Module syntax:** ES modules only (`import`/`export`)
- **Mixed .ts/.js:** Codebase uses both TypeScript and JavaScript files
- **Comments:** JSDoc for public APIs, inline comments for complex logic
- **Error handling:** No excessive validation - trust internal code, validate at boundaries
