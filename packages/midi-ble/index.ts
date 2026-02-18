/**
 * @harmoneasy/midi-ble
 * Bluetooth MIDI (BLE) implementation for HarmonEasy
 */

export {
  BLEMIDIConnection,
  BLEMIDIDevice,
} from './ble-midi-connection.ts'

export {
  BLEMIDIService,
} from './ble-midi-service.ts'

export {
  createBLEMIDI,
  requestBLEDevice,
  getBLEMIDIDevices,
} from './ble-midi-factory.ts'

export {
  BLEMIDIError,
  BLEMIDIConnectionError,
  BLEMIDITimeoutError,
} from './ble-midi-errors.ts'

export type {
  MIDIMessage,
  BLEMIDIConfig,
} from './ble-midi-types.ts'
