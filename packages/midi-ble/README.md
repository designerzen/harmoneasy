# midi-ble

This workspace package contains a manifest, lint configuration and an incomplete barrel entry. Its actual package name is `midi-ble`, not `@harmoneasy/midi-ble`.

[index.ts](index.ts) re-exports connection, device, service, factory, error and type modules absent from this checkout. Importing the package entry therefore fails resolution; the former `createBLEMIDI`, `sendMessage`, `onMIDIMessage` and reconnection examples were not usable shipped APIs. [package.json](package.json) defines lint scripts and no build or test script.

## BLE MIDI in Harmoneasy

The app's BLE adapters live in audiobus:

- [BLE input](../audiobus/io/inputs/input-ble-midi-device.ts), factory ID `ble-midi`.
- [BLE output](../audiobus/io/outputs/output-ble-midi-device.ts), factory ID `ble-midi`.
- [Shared Bluetooth connection](../audiobus/midi/midi-ble/ble-connection.ts).

Use audiobus's input/output factories and the app's connection controls. Bluetooth requires a browser exposing `navigator.bluetooth`, a compatible device and permission from a user-activated chooser. Check capabilities at runtime rather than relying on a browser-version list. Desktop/native MIDI is separate.

See [audiobus](../audiobus/README.md#inputs) for routing and lifecycle management.
