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
- `source/libs/midi-ble/` - Bluetooth MIDI support (BLE connection, MIDI streaming)
- `source/libs/pitfalls/` - Music theory (scales, intervals, tuning systems)
- `source/libs/audiotool/` - Integration with Audiotool (@audiotool/nexus)
- `source/components/` - UI components (keyboard, visualizers, canvas)
- `source/libs/state.ts` - Application state management

**Key Classes:**
- [AudioCommand](source/libs/audiobus/audio-command.ts) - Musical events/commands
- [Transformer](source/libs/audiobus/transformers/abstract-transformer.ts) - Audio pipeline transformers
- [MIDIDevice](source/libs/audiobus/midi/midi-device.ts) - MIDI device abstraction

## Code Style
- **Imports:** Use `.ts`/`.js` extensions in all imports (required by Vite config)
- **Types:** Strict TypeScript enabled - use explicit types, avoid `any`
- **Naming:** camelCase for variables/functions, PascalCase for classes/types
- **Module syntax:** ES modules only (`import`/`export`)
- **Mixed .ts/.js:** Codebase uses both TypeScript and JavaScript files
- **Comments:** JSDoc for public APIs, inline comments for complex logic
- **Error handling:** No excessive validation - trust internal code, validate at boundaries
