# @harmoneasy/midi-ble

Bluetooth MIDI (BLE) implementation for HarmonEasy.

## Overview

This package provides Bluetooth MIDI support for connecting wireless MIDI devices like:
- Bluetooth MIDI keyboards
- Bluetooth MIDI controllers
- Bluetooth MIDI pedals
- Mobile MIDI apps over BLE

## Installation

```bash
pnpm install @harmoneasy/midi-ble
```

## Usage

### Basic Setup

```typescript
import { createBLEMIDI, BLEMIDIConnection } from '@harmoneasy/midi-ble'

// Request device from user
const device = await navigator.bluetooth.requestDevice({
  filters: [{ services: ['03b80e5a-ede8-4b33-a751-6ce34ec4c700'] }] // BLE MIDI UUID
})

// Create BLE MIDI connection
const bleMidi = await createBLEMIDI(device)

// Listen to MIDI messages
bleMidi.onMIDIMessage((message) => {
  const [status, data1, data2] = message.data
  console.log(`Status: ${status}, Data1: ${data1}, Data2: ${data2}`)
})

// Cleanup
await bleMidi.disconnect()
```

### Sending MIDI Messages

```typescript
// Send note on
bleMidi.sendMessage([0x90, 60, 100]) // Channel 1, Middle C, velocity 100

// Send note off
bleMidi.sendMessage([0x80, 60, 0])

// Send control change
bleMidi.sendMessage([0xB0, 7, 127]) // Channel 1, CC 7 (volume) = max
```

### Device Management

```typescript
// Get list of connected devices
const connectedDevices = await bleMidi.getConnectedDevices()

// Check connection status
if (bleMidi.isConnected()) {
  console.log('Device connected')
}

// Reconnect to device
await bleMidi.reconnect()
```

### Error Handling

```typescript
import { BLEMIDIError } from '@harmoneasy/midi-ble'

try {
  const bleMidi = await createBLEMIDI(device)
} catch (error) {
  if (error instanceof BLEMIDIError) {
    console.error(`BLE MIDI Error: ${error.message}`)
  }
}
```

## MIDI Message Format

BLE MIDI uses standardized MIDI messages. Common status bytes:

- `0x90` - Note On (channel 1)
- `0x80` - Note Off (channel 1)
- `0xB0` - Control Change (channel 1)
- `0xC0` - Program Change (channel 1)
- `0xE0` - Pitch Bend (channel 1)

To change channel, add channel number (0-15) to status byte:
- Channel 1: base (e.g., 0x90)
- Channel 2: base + 1 (e.g., 0x91)
- Channel 16: base + 15 (e.g., 0x9F)

## Browser Support

Requires:
- Web Bluetooth API support
- HTTPS (production only)
- User permission grant

Supported on:
- Chrome 56+
- Edge 79+
- Opera 43+

**Note:** Safari requires third-party WebKit implementation.

## API Reference

### Functions

- `createBLEMIDI(device)` - Create BLE MIDI connection
- `requestBLEDevice()` - Request device from user
- `getBLEMIDIDevices()` - Get paired BLE MIDI devices

### Classes

- **BLEMIDIConnection** - MIDI connection over Bluetooth
  - `sendMessage(message)` - Send MIDI message
  - `disconnect()` - Disconnect device
  - `isConnected()` - Check connection status
  - `onMIDIMessage(callback)` - Listen to MIDI messages

### Types

```typescript
interface MIDIMessage {
  data: [number, number?, number?]
  timestamp: number
}

interface BLEMIDIDevice {
  id: string
  name: string
  connected: boolean
}
```

## Limitations

- Requires HTTPS in production
- User must grant Bluetooth permission
- May have latency compared to wired MIDI
- Limited to devices that support BLE MIDI standard

## Examples

### Keyboard Input

```typescript
const bleMidi = await createBLEMIDI(device)

bleMidi.onMIDIMessage((message) => {
  if (message.data[0] === 0x90) { // Note On
    const note = message.data[1]
    const velocity = message.data[2]
    console.log(`Playing note ${note}`)
  }
})
```

### Volume Control

```typescript
// Read volume CC (CC 7)
bleMidi.onMIDIMessage((message) => {
  if (message.data[0] === 0xB0 && message.data[1] === 7) {
    const volume = message.data[2] / 127 // 0-1 range
    audioContext.destination.gain.value = volume
  }
})
```

## License

MIT

## See Also

- [@harmoneasy/audiobus](../audiobus) - Audio engine
- [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [MIDI Standard](https://www.midi.org/)
