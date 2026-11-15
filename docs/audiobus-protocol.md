# audioBus Protocol integration

The standalone package lives in [designerzen/audiobus-protocol](https://github.com/designerzen/audiobus-protocol). For development, clone it beside this checkout as `../audiobus-protocol`; the workspace includes that directory and overrides audioBus's package dependency with the local package.

```sh
git clone https://github.com/designerzen/audiobus-protocol.git ../audiobus-protocol
cd ../audiobus-protocol
npm install
npm test
npm run example
cd ../harmoneasy
pnpm install --ignore-scripts
```

Build the protocol package after editing it (`npm run build` in that checkout). It exports built JavaScript and declarations. audioBus pins the GitHub dependency to a tested commit; its `prepare` script builds JavaScript and declarations during Git installation. This workspace overrides that dependency with the sibling checkout for development. No npm release is required.

## Shared application commands

Harmoneasy registers these commands after its clock and transport are initialized:

| ID | Arguments | Result |
| --- | --- | --- |
| `transport.get` | `{}` | `{bpm, running, clockSource}` |
| `transport.setTempo` | `{bpm: number}` | updated transport state |
| `transport.start` | `{}` | updated transport state |
| `transport.stop` | `{}` | updated transport state |
| `app.panic` | `{}` | `null` |

Tempo is restricted to 10–303 BPM and is available only when the internal clock is locally controlled. Start/stop are unavailable while following shared, MIDI, or DVS transport, matching the local transport controls. Calls use application services, not simulated button clicks. The palette includes registered commands alongside its existing visible UI controls; argument forms are generated from the command schemas. Remote calls use the same registry and validation.

### Interface controls

Everything else the command palette offers is available remotely through three commands. They use the palette's own discovery, so a control is listed exactly when the palette would offer it: visible, enabled and outside closed dialogs.

| ID | Arguments | Result |
| --- | --- | --- |
| `ui.list` | `{query?: string}` | `[{id, label, context, kind, value, options?, min?, max?, step?}]` |
| `ui.activate` | `{id}` | the control after pressing it |
| `ui.setValue` | `{id, value: string}` | the control after setting it |

IDs combine the control's context and label, such as `transport/play`, with `~2` added to repeated names. They stay stable while the interface is unchanged; list again after opening a dialog or adding a device. `kind` is `action` or `toggle` for `ui.activate`, and `choice`, `number` or `text` for `ui.setValue`. Choices accept an option's text or value; numbers are checked against the control's range. Values are applied with the same events as a person editing the control. Controls that need a browser user gesture, such as file pickers or starting audio, may still need local interaction. The palette does not list the `ui.*` commands themselves.

### MIDI commands

Each audioBus Protocol Input also offers discoverable MIDI commands, grouped as the `org.audiobus.midi` version 1 bundle. They play into that Input's chain exactly like WebMidiLink MIDI from the same peer, so held notes are released on disconnect.

| ID | Arguments |
| --- | --- |
| `midi.noteOn` | `note`, `velocity?` (1–127, default 100), `channel?` (1–16, default 1) |
| `midi.noteOff` | `note`, `velocity?`, `channel?` |
| `midi.polyAftertouch` | `note`, `pressure`, `channel?` |
| `midi.channelAftertouch` | `pressure`, `channel?` |
| `midi.pitchBend` | `value` (−8192 to 8191, 0 is centre), `channel?` |
| `midi.controlChange` | `controller`, `value`, `channel?` |
| `midi.programChange` | `program`, `channel?` |
| `midi.allNotesOff` | `channel?` |

Subscribe to `transport.changed` for changes. Calls publish immediately; local controls, external clocks and room changes are observed every 100 ms. `commands.changed` tells clients to refresh discovery, including availability. `transport.changed` is retained: `subscribeState('transport.changed')` returns the current `{bpm, running, clockSource}` in the subscription response, captured atomically with it, so no separate `transport.get` is needed and no change can fall between the two.

## Pair another application

Add the **audioBus Protocol** Input to a graph chain. Its panel can open a peer application's HTTP(S) URL, retaining its window reference and exact origin. Once that application has installed its listener, press Connect. The peer application must implement audioBus Protocol; existing OpenDAW does not gain support simply by opening its URL. By default there is no automatic acceptance of arbitrary message senders.

### Unpaired control

Tick **Accept control from any window without pairing** in the Input panel, or set the Input option `acceptUnpaired: true`, then press Connect. The Input then accepts protocol messages from any window that can message it, such as a page that opened or embeds Harmoneasy, without pairing or a code. Each sending window gets its own session and replies go only to that window's origin. Windows with an opaque origin, such as `file://` pages, are ignored, and at most eight windows may connect at once. A paired application can still be attached alongside. The setting is saved with the project and is off by default. Turn it on only for pages you trust: an unpaired window can play notes and, through the interface commands, press any control.

Embedding hosts can pair programmatically instead:

```ts
import InputProtocol from 'audiobus/io/inputs/input-protocol'

const input = new InputProtocol()
// Register input with the desired chain using the usual input lifecycle.
input.attach(iframe.contentWindow!, new URL(iframe.src).origin)
await input.connect()
// Both peers can now discover and invoke registered application commands.
console.log(await input.connection!.list())
// On teardown:
input.destroy()
```

Use `getProtocolRegistry()` from `audiobus/io/protocol-registry` to register more application commands. A custom registry can be provided to an individual Input through its constructor options; `setProtocolRegistry()` replaces the default for subsequently created peers and palettes.

The Input routes incoming `midi,…` strings through the existing MIDI converter and graph dispatch path. SysEx is disabled unless the host sets `allowSysex:true`. Disconnect releases sustain and held notes and removes the listener. Pairing configuration is intentionally runtime-only: saved projects do not retain window references, and restored Inputs must be paired again. Browsers may isolate popup windows under cross-origin isolation policies; use a cooperating iframe or another supported transport where a popup reference is unavailable.

## Protocol Output

Add **audioBus Protocol** from the Output picker to send a chain's transformed MIDI to another application. The panel provides a destination URL, protocol mode, pairing button, command discovery, and argument forms for remote commands. It produces no local audio. Notes, channels, velocity, controllers, program changes, pressure, pitch bend, and MIDI system bytes use the existing MIDI encoder. SysEx requires `allowSysex:true`.

Choose **audioBus Protocol** for version negotiation and symmetric command control. Choose **WebMidiLink (MIDI and patches)** for existing synths that do not implement the command handshake. Legacy mode does not expose Harmoneasy's command registry. Both modes release tracked notes and sustain before disconnecting, replacing the destination, or destroying the Output.

For a working destination, build the protocol repository and serve its `examples/receiver.html` over HTTP(S). Enter that URL in the Output and open it. In the receiver, enter Harmoneasy's exact origin and click **Accept opening application**. Copy the pairing code it shows into the Output's **Pairing code** field, then press **Connect** in the Output. Click **Enable sound** in the receiver to hear notes. The Output discovers the receiver's tempo and panic commands automatically; these are demonstrations, not an OpenDAW implementation. Browser isolation policies must permit the popup relationship; otherwise use a cooperating iframe or custom transport.

To connect two Harmoneasy windows, add the Output in the opening window and an Input in the destination window. In the Input panel, enter the opening application's URL and choose **Pair with opening application**. The Input shows a pairing code; enter it in the Output's **Pairing code** field, then press Connect on both sides within five seconds. Until the Output presents that code, the Input ignores its MIDI and patches and rejects its commands, even if the Input connected first. Five incorrect attempts lock the pairing; choose **Pair with opening application** again for a new code. Codes are never saved with the project. Initialization retries while the listener is being installed; application commands are never retried. The Input routes received notes through its own chain, while both peers expose their application's commands. Keep routing directional to avoid MIDI feedback.

```ts
import OutputProtocol from 'audiobus/io/outputs/output-protocol'
import { EVENT_PROTOCOL_EVENT, EVENT_PROTOCOL_PATCH } from 'audiobus/events/event-constants'

const output = new OutputProtocol({ applicationName: 'Harmoneasy' })
output.attach(iframe.contentWindow!, new URL(iframe.src).origin)
await output.connect()
console.log(await output.discover()) // Validated, typed command descriptors
const { state } = await output.subscribeState('transport.changed') // current state, when retained
output.addEventListener(EVENT_PROTOCOL_EVENT, event => console.log((event as CustomEvent).detail))
await output.call('transport.setTempo', { bpm: 128 })
output.noteOn(60, 100, 2)
output.noteOff(60, 2)
output.addEventListener(EVENT_PROTOCOL_PATCH, event => console.log((event as CustomEvent).detail))
output.requestPatch() // Optional legacy Level 1 exchange; replies arrive as events.
output.setPatch(encodeURIComponent(JSON.stringify({ bpm: 128 })))
output.destroy()
```

`attachTransport(transport)` supports an already-authorized custom transport (for example desktop IPC). It must isolate one destination. `discover()`, `call()`, `subscribe()` and `unsubscribe()` require a connected Output in audioBus mode; patch methods also work in legacy mode. Connection changes emit the standard `EVENT_CONNECTION_CHANGED`; remote events and patch replies emit `EVENT_PROTOCOL_EVENT` and `EVENT_PROTOCOL_PATCH`. Window references and listeners are runtime-only. The saved URL and mode do not reconnect automatically.

## MIDI 2, properties and bundles (SDK 0.2)

Input and Output negotiate the optional `ump` capability and preserve full unsigned UMP words. A native UMP command stays in UMP form through Protocol Output, including 16-bit velocity, 32-bit controllers, per-note data and groups. Group zero through fifteen remain distinct in note identity, retrigger balancing and sustain/note release. MIDI 1 UMP Channel Voice transformations rebuild the packet; MIDI 2 transformations preserve untouched high-resolution fields and update changed notes, velocity, channel or group. `IAudioCommand.midiGroup` is zero-based.

The Output refuses UMP when the destination did not negotiate it. The **Allow lossy MIDI 1 conversion for group zero** checkbox opts into reducing representable group-zero messages for older destinations. Conversion never merges other groups, and per-note/unrepresentable packets still reject. SysEx7/SysEx8 UMP data requires `allowSysex:true`, just like byte SysEx. Timing packets are transported, not interpreted as a synchronized browser scheduler.

Harmoneasy also registers these scalar properties:

| Property | Schema | Access |
| --- | --- | --- |
| `transport.tempo` | number, 10–303, unit BPM | writable while locally controlling the internal clock |
| `transport.running` | boolean | read-only |
| `transport.clockSource` | string | read-only |

The palette includes writable properties with their units and schema-generated editors. The Protocol Output panel also discovers destination properties, reads current values, provides validated editors, reflects notifications and disables read-only controls. Programmatically use `output.listProperties()`, `getProperty(id)` and `setProperty(id,value)`; `output.listBundles()` discovers named contracts.

`org.audiobus.transport` version 1 requires the five transport/panic commands and the three properties above. This is an audioBus application contract, not a MIDI Association Profile. Clients must still check each member's runtime availability and writability. Notifications use `properties.changed` with `{id,value}` and `properties.listChanged` for metadata changes; local application changes are observed at 100 ms intervals. Writes return the actual value after the host setter completes. Subscribe before initial reads and tolerate repeated values.

The standalone repository includes `npm run example:midi2` and an upgraded receiver that advertises UMP, tempo properties and a demo bundle. The receiver logs exact UMP words; its optional synth approximates velocity/controllers for sound. The API is inspired by MIDI-CI Property Exchange but does not implement MIDI-CI SysEx resource discovery, MUIDs, chunking, Profile configuration, or native hardware bridging.

## Verification

In the protocol repository: `npm test` and `npm run example`.

In `app/harmoneasy`:

```sh
pnpm exec vitest run tests/command-palette.test.ts tests/command-palette-protocol.test.ts tests/application-commands.test.ts tests/input-protocol.test.ts tests/output-protocol.test.ts
```

The browser example in the protocol repository requires a static HTTP server. Its readiness message is example-specific; production applications should coordinate listener readiness through their own embedding lifecycle before initializing.
