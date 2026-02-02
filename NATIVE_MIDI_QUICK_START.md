# Native MIDI Quick Start Guide

## For Developers

### Build Native Module
```bash
npm run build-native
```

### Using Native MIDI in Your Code

#### Output (Send MIDI)
```typescript
import OutputNativeMIDIDevice from '@/libs/audiobus/io/outputs/output-native-midi-device.ts'

const midi = new OutputNativeMIDIDevice()
await midi.connect()

// Send note on (channel 1)
midi.noteOn(60, 100, 1)        // Note, velocity, channel

// Send note off
midi.noteOff(60, 1)

// Send control change (CC 7 = volume)
midi.controlChange(7, 127, 1)

// Send pitch bend
midi.pitchBend(8192, 1)         // 8192 = center

// Get available devices
const devices = midi.getAvailableDevices()
console.log(devices)  // [{index: 0, name: "Device Name"}, ...]

// Switch device
await midi.selectDevice(0)

// Cleanup
await midi.disconnect()
```

#### Input (Receive MIDI)
```typescript
import InputNativeMIDIDevice from '@/libs/audiobus/io/inputs/input-native-midi-device.ts'

const input = new InputNativeMIDIDevice()
await input.connect()

input.on('noteon', (event) => {
  console.log(`Note: ${event.note}, Velocity: ${event.velocity}, Channel: ${event.channel}`)
})

input.on('noteoff', (event) => {
  console.log(`Note off: ${event.note}`)
})

input.on('controlchange', (event) => {
  console.log(`CC ${event.controller}: ${event.value}`)
})

input.on('pitchbend', (event) => {
  console.log(`Pitch bend: ${event.value}`)
})

input.on('programchange', (event) => {
  console.log(`Program: ${event.program}`)
})

// Cleanup
await input.disconnect()
```

### Direct Native Module Access
```javascript
const nativeMIDI = require('./build/Release/midi2-native.node')

// List devices
console.log(nativeMIDI.getUmpOutputs())
console.log(nativeMIDI.getUmpInputs())

// Get platform capabilities
console.log(nativeMIDI.getCapabilities())
// {
//   platform: 'Windows' | 'macOS' | 'Linux',
//   midi2Support: true,
//   umpSupport: true,
//   nativeOSSupport: true,
//   maxPayload: 65536
// }

// Send raw UMP packet (32-bit)
nativeMIDI.openUmpOutput(0)
nativeMIDI.sendUmp(0, 0x90603C)  // Note on, channel 1, note 60, velocity 60
nativeMIDI.closeUmpOutput(0)
```

## MIDI Note Numbers
```
C4 (Middle C) = 60
A4 (Concert Pitch) = 69
```

## Control Change (CC) Common Codes
```
CC 1   = Modulation
CC 7   = Volume (Master)
CC 10  = Pan
CC 11  = Expression
CC 64  = Sustain Pedal
CC 120 = All Sound Off
CC 121 = Reset All Controllers
CC 123 = All Notes Off
```

## Platform Support
- ✅ Windows 7+ (MM API)
- ✅ macOS 10.5+ (CoreMIDI)
- ✅ Linux (ALSA)

## Troubleshooting

### Native module not found
```bash
npm run build-native:clean
npm run build-native
```

### No devices detected
- **Windows**: Check Device Manager for MIDI devices
- **macOS**: Open Audio MIDI Setup
- **Linux**: Run `aconnect -l`

### Build errors on macOS
```bash
# Install Xcode tools
xcode-select --install
```

### Build errors on Linux
```bash
# Install ALSA development headers
sudo apt-get install libasound2-dev
```

## MIDI 2.0 (Coming in 2 Days)
The native implementation is ready for MIDI 2.0 when the spec arrives. Current UMP format supports:
- 32-bit packets (MIDI 1.0)
- 64-bit packets (MIDI 2.0) - structure in place
- Extended message formats
- Per-note controllers

## Documentation
- Full guide: [NATIVE_MIDI_MIGRATION.md](NATIVE_MIDI_MIGRATION.md)
- Implementation details: [NATIVE_MIDI_IMPLEMENTATION.md](NATIVE_MIDI_IMPLEMENTATION.md)
- Source code: [native/midi2-native.cc](native/midi2-native.cc)

## Performance Tips
- Use output batching for multiple messages
- Use input event listeners instead of polling
- Close devices when not in use
- Check device availability before accessing
