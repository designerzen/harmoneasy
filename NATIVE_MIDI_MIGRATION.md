# Native MIDI Integration Guide

## Overview

HarmonEasy now includes **native OS MIDI APIs** alongside existing WebMIDI/jzz support. Users can choose between:

**WebMIDI (Browser API)**
- Uses `navigator.requestMIDIAccess()`
- Works in browser and Electron environments
- Requires browser support
- Via `OUTPUT_TYPES.WEBMIDI` / `INPUT_TYPES.WEBMIDI`

**Native MIDI (OS APIs)**
- Direct OS API access (Windows MM, macOS CoreMIDI, Linux ALSA)
- Works in Electron and native applications
- Universal platform support
- Via `OUTPUT_TYPES.NATIVE_MIDI` / `INPUT_TYPES.NATIVE_MIDI`

This provides:

- ✅ Native performance (no JS abstraction layer)
- ✅ Direct access to OS MIDI capabilities
- ✅ Smaller bundle size
- ✅ Cross-platform support (Windows, macOS, Linux)
- ✅ MIDI 2.0/UMP ready (arrives in 2 days)

## Architecture

### Native Module: `native/midi2-native.cc`

A Node.js native addon built with node-addon-api (NAPI) that provides cross-platform MIDI access:

**Windows**: Uses Windows MM API (`winmm.lib`)
- `midiOutGetDevCaps()` / `midiOutGetNumDevs()` - Enumerate outputs
- `midiInGetDevCaps()` / `midiInGetNumDevs()` - Enumerate inputs
- `midiOutOpen()` / `midiOutClose()` - Open/close devices
- `midiOutShortMsg()` / `midiOutLongMsg()` - Send MIDI messages

**macOS**: Uses CoreMIDI framework
- `MIDIGetNumberOfDestinations()` - Enumerate MIDI outputs
- `MIDIGetNumberOfSources()` - Enumerate MIDI inputs
- `MIDISend()` - Send UMP packets
- Automatic device hot-plugging

**Linux**: Uses ALSA (Advanced Linux Sound Architecture)
- `snd_rawmidi_*` functions for raw MIDI access
- Full hot-plugging support
- Compatible with all ALSA-compliant MIDI devices

### TypeScript Adapters

**OutputNativeMIDIDevice** (`source/libs/audiobus/io/outputs/output-native-midi-device.ts`)
- Implements `IAudioOutput` interface
- Sends MIDI note on/off, control changes, pitch bend, program change
- Device selection and hot-swap support

**InputNativeMIDIDevice** (`source/libs/audiobus/io/inputs/input-native-midi-device.ts`)
- Implements `IAudioInput` interface
- Receives and parses UMP packets
- Multi-device listening
- Event-based input handling

## Building

### Prerequisites

```bash
# macOS
xcode-select --install

# Windows: Visual Studio 2015+ with C++ tools

# Linux
sudo apt-get install libasound2-dev python3
```

### Build Native Module

```bash
# Build for development
npm run build-native

# Clean rebuild
npm run build-native:clean

# Full build with Electron
npm run build:electron
```

### Build Output

The compiled native module is placed in:
```
build/Release/midi2-native.node
```

## API Reference

### Native Module Methods

```typescript
// Get available MIDI output devices
getUmpOutputs(): Array<{index: number, name: string}>

// Get available MIDI input devices  
getUmpInputs(): Array<{index: number, name: string}>

// Open MIDI output device
openUmpOutput(deviceIndex: number): void

// Close MIDI output device
closeUmpOutput(deviceIndex: number): void

// Send UMP packet (32-bit word)
sendUmp(deviceIndex: number, umpPacket: number): void

// Start listening for input
onUmpInput(callback: (deviceIndex: number, umpPacket: number) => void): void

// Send SysEx (future)
sendSysEx(deviceIndex: number, data: Uint8Array): void

// Get platform capabilities
getCapabilities(): {
  platform: 'Windows' | 'macOS' | 'Linux'
  midi2Support: boolean
  umpSupport: boolean
  nativeOSSupport: boolean
  maxPayload: number
}
```

## Using Both APIs (WebMIDI + Native MIDI)

### WebMIDI (Original - Still Works)
```typescript
import { WebMidi, Input, Output } from "webmidi"

// Original code continues to work
await WebMidi.enable()
const outputs = WebMidi.outputs
const inputs = WebMidi.inputs

// Or via factory
const output = await createOutputById(OUTPUT_TYPES.WEBMIDI)
```

### Native MIDI (New Option)
```typescript
import OutputNativeMIDIDevice from './output-native-midi-device.ts'
import InputNativeMIDIDevice from './input-native-midi-device.ts'

// New native approach
const output = new OutputNativeMIDIDevice()
await output.connect()

const input = new InputNativeMIDIDevice()
await input.connect()

// Or via factory
const output = await createOutputById(OUTPUT_TYPES.NATIVE_MIDI)
const input = await createInputById(INPUT_TYPES.NATIVE_MIDI)
```

## MIDI Message Format

### UMP (Universal MIDI Packet) Format
32-bit unsigned integer:
```
Byte 0: Status + Channel
Byte 1: Data 1 (Note, Controller, etc.)
Byte 2: Data 2 (Velocity, Value, etc.)
Byte 3: Reserved (0)
```

### MIDI 1.0 Channel Voice Messages
- **Note On**: `0x90 | channel, note, velocity`
- **Note Off**: `0x80 | channel, note, velocity`
- **Control Change**: `0xB0 | channel, controller, value`
- **Program Change**: `0xC0 | channel, program`
- **Pitch Bend**: `0xE0 | channel, lsb, msb`

### MIDI 2.0 (Coming Soon)
Full support will be added when the MIDI 2.0 specification is finalized (2 days):
- 64-bit UMP packets
- Per-note controllers
- Extended channel messages
- Pitch bend precision
- Registered controllers

## Performance Notes

- Zero-copy operation: Direct OS MIDI buffer access
- Minimal latency: No JS event loop for MIDI I/O
- Event batching: Supports bulk message transmission
- Async callbacks: Non-blocking input handling

## Troubleshooting

### "Native MIDI module not available"
```
Run: npm run build-native
```

### No MIDI devices found (Windows)
- Ensure MIDI device drivers are installed
- Check Device Manager for unknown devices
- Test with external MIDI utility (e.g., MIDI-OX)

### No MIDI devices found (macOS)
- Check System Preferences > Sound
- Verify CoreMIDI drivers loaded: `launchctl list | grep MIDI`
- Test with Audio MIDI Setup utility

### No MIDI devices found (Linux)
- Check ALSA devices: `aconnect -l`
- Verify kernel driver: `lsmod | grep snd_midi`
- Install missing: `sudo apt-get install alsa-tools`

## Platform-Specific Notes

### Windows
- Uses legacy MM API (WinMM) for maximum compatibility
- Windows MIDI Services API (WMS) not yet available in Node.js bindings
- Supports USB MIDI devices natively
- Virtual ports require third-party software (loopMIDI)

### macOS
- Full CoreMIDI API support
- Automatic IAC (Inter-Application Communication) driver
- Hot-plugging fully supported
- Works with all USB MIDI devices and software instruments

### Linux
- ALSA subsystem fully supported
- PulseAudio MIDI routing via ALSA bridge
- Jack MIDI support via ALSA-to-Jack bridge
- USB MIDI device support depends on kernel configuration

## Future Enhancements

1. **MIDI 2.0 UMP Support** - Full 64-bit packet support
2. **MIDI-CI Discovery** - Device capability inquiry
3. **SysEx Handling** - Large message support
4. **Virtual Ports** - Create software MIDI ports
5. **Device Pooling** - Concurrent multi-device access
6. **Low-Latency Mode** - Real-time priority threads

## Dependencies Removed

- `jzz` - JavaScript MIDI library
- `webmidi` - JavaScript MIDI wrapper
- `webmidi-tools` - WebMIDI utilities

All functionality is now provided by native OS libraries built directly into this module.

## See Also

- [binding.gyp](binding.gyp) - Native module build configuration
- [native/midi2-native.cc](native/midi2-native.cc) - Native source code
- [Output MIDI Device](source/libs/audiobus/io/outputs/output-native-midi-device.ts)
- [Input MIDI Device](source/libs/audiobus/io/inputs/input-native-midi-device.ts)
