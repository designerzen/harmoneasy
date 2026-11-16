# Preset URL API — version 1

Compose a musical setup in a link: extend a published preset, load any reachable MIDI file, replace selected parts, or supply an entire workspace. URLs configure the start screen; the recipient still starts audio explicitly and grants any required device permissions. This is a browser URL API, not a server-side music-rendering service.

Examples below use `https://designerzen.github.io/harmoneasy/` and require a deployment containing this API. For local development, replace that prefix with `http://127.0.0.1:1999/`. Relative MIDI paths resolve from the application root, regardless of which preset page contains the link.

## Quick examples

| Open a setup | What the link does |
| --- | --- |
| [Rickroll with spoken note names](https://designerzen.github.io/harmoneasy/presets/songs/never-gonna-give-you-up/parts/v1/outputs/speech-synthesis/) | Retains the song preset and instrument, adding speech to its melody. |
| [Speech-only Rickroll](https://designerzen.github.io/harmoneasy/presets/songs/never-gonna-give-you-up/parts/v1/outputs/speech-synthesis/outputs-mode/replace/) | Replaces the chain's output connections with speech. |
| [Dynamic MIDI melody with sound and speech](https://designerzen.github.io/harmoneasy/parts/v1/outputs/moog,speech-synthesis/?midi=midi%2Fnever-gonna-give-you-up.mid) | Builds a new setup; change `midi` to another file URL. |
| [Live keyboard with speech and text](https://designerzen.github.io/harmoneasy/parts/v1/inputs/keyboard,onscreen-keyboard/outputs/speech-synthesis,describe/) | Reads the actual notes played, without a song or instrument. |
| [Keyboard transposed up an octave](https://designerzen.github.io/harmoneasy/parts/v1/inputs/keyboard/outputs/moog/transformers/Transposer/?config=%7B%22steps%22%3A%7B%22url-chain%22%3A%7B%220%22%3A%7B%22distance%22%3A12%7D%7D%7D%7D) | Builds a chain and configures its first transformer. |
| [Electro with notation](https://designerzen.github.io/harmoneasy/presets/genres/electro/parts/v1/outputs/notation/?bpm=120) | Extends an existing multi-chain setup; its input routing and steps remain. |
| [Gamepad ensemble with another song](https://designerzen.github.io/harmoneasy/presets/activities/ensemble-any-song-gamepads/parts/v1/outputs/speech-synthesis/?midi=midi%2Fode-to-joy.mid) | Keeps Ensemble's channel/gamepad allocation and changes the MIDI file. |
| [Exact BitMidi track with speech](https://designerzen.github.io/harmoneasy/play/bitmidi/never-gonna-give-you-up-1-mid/parts/v1/outputs/speech-synthesis/) | Resolves a BitMidi record and adds speech. Requires BitMidi availability. |
| [Artist/title search with notation](https://designerzen.github.io/harmoneasy/play/rick-astley/never-gonna-give-you-up/parts/v1/outputs/notation/) | Uses the closest search result. Use an exact BitMidi slug or file URL for deterministic song selection. |
| [Query-only Rickroll](https://designerzen.github.io/harmoneasy/?v=1&preset=songs%2Fnever-gonna-give-you-up&outputs=speech-synthesis) | Equivalent to extending the song using the path form. |
| [Replace Electro with a live speech setup](https://designerzen.github.io/harmoneasy/presets/genres/electro/parts/v1/?mode=replace&inputs=keyboard&outputs=speech-synthesis) | Ignores the preset and builds a new setup entirely from the query. |
| [A setup with a room invitation](https://designerzen.github.io/harmoneasy/parts/v1/outputs/moog,notation/?room=classroom) | Supplies a local setup and a room name. Connection/pairing still follows the normal collaboration flow. |

## Routes and encoding

```text
<app>/parts/v1/<key>/<value>/<key>/<value>/...
<app>/<preset-route>/parts/v1/<key>/<value>/...
<app>/play/<artist>/<title>/parts/v1/<key>/<value>/...
<app>/?v=1&key=value&key=value
<app>/<preset-route>/?v=1&key=value
```

`<preset-route>` is any published `presets/...`, `preset/...` or `hardware/...` route. The same suffix works for song, activity, accessibility, genre and hardware presets. `/parts/v1/` without additional pairs is valid. A final slash is optional. Paths must contain complete key/value pairs; keys and IDs are case-sensitive. Input/output IDs are generally lowercase; transformer IDs include names such as `Transposer`, `Harmoniser`, `MIDI-File-Player` and `Ensemble`.

Encode each path value as one segment with `encodeURIComponent(value)`. In particular, a slash inside `midi` or `preset` must be `%2F`:

```text
/parts/v1/preset/songs%2Fode-to-joy/outputs/speech-synthesis/
/parts/v1/midi/midi%2Fode-to-joy.mid/outputs/moog,speech-synthesis/
```

For URLs, JSON or longer settings, prefer query parameters and construct them with `URLSearchParams`. An external MIDI URL such as `https://files.example/song.mid?download=1&version=2` must be encoded as one parameter value; its `&` characters must not become additional API options. Decode values only once. `+` means a space in queries, but remains a literal plus in path values.

GitHub Pages uses the generated 404 fallback to recover dynamic path links, retaining their queries and fragments. Hosts with SPA rewrites can serve the app directly. `/parts/v1/` also has a static application entry point. Query-only links avoid unknown-path redirects and are useful when a host or sharing service does not preserve encoded path segments. The internal `parts-route` redirect parameter is reserved; do not author it yourself.

## Selection and precedence

1. Choose the base: an inherited preset/play route, `preset=...`, `setup=...`, or a new setup. `preset` and `setup` override the inherited route and are mutually exclusive. A query containing `preset`, `setup` or `mode=replace` replaces the path's entire base-selector group (`preset`, `setup`, `mode`); conflicting selectors within the query are still errors.
2. `mode=replace` discards the inherited route and starts a new setup. It cannot be combined with `preset` or `setup`; those already select a base explicitly.
3. For each option, query values replace path values. For backward compatibility, `#midi=...` and `#outputs=...` supply defaults in version 1; paths and queries override them. Other fragment fields belong to the app's existing sharing/pairing APIs.
4. Select chains; replace requested sections; add inputs, outputs and transformer steps; then apply `config`.
5. Apply `midi`, `track`, `playback`, `loop`, clock and display-name shortcuts last. These override the equivalent fields supplied by `config`.
6. Validate the resulting workspace before restoring devices.

Repeated scalar options at the same level are errors. Repeated list options are allowed: `outputs=moog&outputs=notation` is the same as `outputs=moog,notation`. Query lists replace the entire path list, rather than merging across levels. Inputs and outputs are deduplicated; transformer repetition and ordering are preserved. Existing registry-backed devices of the same type are reused and their selected chain connections are enabled. Adding a type does not create a second instance of it; use `setup` for separately configured instances.

Ordinary presets and play links continue to work. Legacy links using only `midi`/`outputs` without a version retain their earlier fragment-first behaviour and MIDI template defaults. Use `/parts/v1/` or `v=1` for the rules in this guide. New composition parameters also opt a link into version 1; including the version explicitly makes published links clearer.

## Parameters

All parameters except `v` can appear as path pairs or query parameters. Values must be non-empty; `none` explicitly denotes an empty input/output/transformer list.

| Parameter | Value and behaviour |
| --- | --- |
| `v` | Query version, exactly `1`. The path version is `parts/v1`. |
| `preset` | Local route, e.g. `songs/ode-to-joy`, `presets/genres/electro` or `hardware/arcana/strum`. Routes without a recognised prefix receive `presets/`. External preset URLs, traversal and query strings are rejected. |
| `setup` | JSON containing a complete exported `harmoneasy-preset` version 1 page; replaces the inherited base. See below. |
| `mode` | `extend` (default) or `replace`. Replace starts a new single-chain setup and does not fetch the inherited preset/play route. |
| `chain` | Exact existing chain ID. Scopes list changes and MIDI shortcuts to that chain. Omit to target all chains. Does not create or rename chains. |
| `inputs` | Comma-separated or repeated registered input IDs; adds connections by default. |
| `outputs` | Comma-separated or repeated registered output IDs; adds connections by default. |
| `transformers` | Comma-separated or repeated registered transformer IDs; appends steps in order, using their default settings. `identity` is also accepted. |
| `inputs-mode` | `append` (default) or `replace`; requires `inputs`. Replace clears selected input connections before adding the list. |
| `outputs-mode` | `append` (default) or `replace`; requires `outputs`. Replace clears selected output connections before adding the list. |
| `transformers-mode` | `append` (default) or `replace`; requires `transformers`. Replace clears selected steps before adding the list. |
| `midi` | HTTP(S) MIDI file URL or app-root-relative path, e.g. `midi/ode-to-joy.mid`. Replaces the file in targeted MIDI File Player/Ensemble steps. Other preset steps are retained. |
| `playback` | MIDI File Player only: `step` advances one melody note per playing action; `file` triggers the whole file. This does not enable autoplay. |
| `track` | MIDI File Player only: integer `-1` through `65535`; `-1` automatically chooses the melody, otherwise the zero-based track index. Actual available tracks depend on the file. |
| `loop` | Exactly `true` or `false`, for targeted MIDI File Player/Ensemble steps. |
| `bpm` | Tempo, numeric `10`–`303`. |
| `swing` | Numeric fraction `0`–`1`. |
| `divisions` | Integer clock divisions per quarter note, `1`–`960`. |
| `bars` | Integer bar count, `1`–`32`. |
| `name` | Non-empty page/setup name. Does not rename individual chains; use `config.chains` for that. |
| `description` | Non-empty page/setup description. |
| `config` | JSON object with `devices`, `chains` and/or `steps` sections; addressed by ID, as described below. |

Numbers use ordinary decimal notation: no hexadecimal, exponent notation or `NaN`. Booleans are lowercase. Unknown path/query options, versions, registry IDs, chain/device/step references, malformed JSON and invalid workspace references are errors displayed on the start screen. `room`, `room-setup`, `sync-bundle`, `play`, internal redirects and `utm_*` query metadata are allowed alongside the schema; their existing subsystems retain responsibility for them.

### Defaults and removal

A new setup has one active chain, `url-chain`, tempo 110, swing 0, 24 divisions and 4 bars. If `inputs` is omitted, it connects computer and onscreen keyboards. If `outputs` is omitted, it connects Moog. Specifying either list replaces that default choice: `outputs=speech-synthesis` produces speech without an instrument in a new setup. `inputs=none&outputs=none` creates an intentionally unconnected chain.

When a new setup supplies `midi` without a MIDI File Player or Ensemble in its transformer list, a MIDI File Player is inserted first, with `playback=step` and looping enabled. In an existing setup, MIDI shortcuts require an existing targeted File Player/Ensemble; no transformer is silently inserted. Changing the file resets a File Player to automatic track selection unless `track` is also supplied. Ensemble's channel assignments and controller configuration are preserved; `track` and `playback` are rejected when targeting Ensemble.

For an existing setup, `outputs=none` alone adds nothing. To remove all selected output connections, use `outputs=none&outputs-mode=replace`; the analogous rules apply to inputs and transformers. Section replacement disconnects devices but retains them in the workspace so other chains and saved surfaces can still refer to them. When replacing transformer steps, update any control-surface bindings that referenced removed steps, or supply a complete revised `setup`.

## Discover IDs and settings

Browse the app's input/output/transformer pickers for capabilities. The [README input/output tables](../readme.md#inputs) list common IDs. Current implementation registries are [inputs](../packages/audiobus/io/input-definitions.ts), [outputs](../packages/audiobus/io/output-definitions.ts) and [transformers](../packages/audiobus/io/transformer-factory.ts); hardware input availability may also depend on runtime profile discovery.

A published preset's data is at `<preset-route>/preset.json`, for example [Rickroll preset JSON](https://designerzen.github.io/harmoneasy/presets/songs/never-gonna-give-you-up/preset.json). Inspect `workspace.devices[].id`, `workspace.chains[].id` and each chain's ordered transformer configuration. Use an exported preset to discover exact device/transformer option names and values. The [preset directory JSON](https://designerzen.github.io/harmoneasy/presets/index.json) lists published routes.

New registry-backed devices receive IDs `url-input-<type>` or `url-output-<type>`; collisions append `-added` until the ID is unique. Reused devices retain their existing IDs. Full setups can assign their own IDs. Separate devices with the same type, shared devices across chains, plugins, custom controller bindings and dependent onscreen keyboard displays belong in a full setup.

## Targeted configuration

`config` shallowly merges settings into existing targets. It cannot create devices/chains or change a transformer's type. Arrays and nested property values replace that property's previous value, rather than deep-merging. Missing IDs and out-of-range step indices are errors. Configuration targets are explicit, so `chain=` does not further restrict them; modifying a shared device affects every chain using it.

```json
{
  "devices": {
    "url-output-speech-synthesis": { "volume": 0.7, "interruption": false }
  },
  "chains": {
    "url-chain": { "name": "My speaking melody", "graphLayout": "vertical" }
  },
  "steps": {
    "url-chain": {
      "0": { "trackIndex": 2, "loop": true },
      "1": { "distance": 12 }
    }
  }
}
```

Here step 0 is a MIDI File Player and step 1 a Transposer. Indices are zero-based and refer to the final list after insertion/replacement/appending. The schema checks configuration structure and references; individual device/transformer option names and musical ranges follow that component's configuration contract, rather than a second universal option validator.

Create the corresponding link without manually escaping JSON:

```js
const url = new URL("https://designerzen.github.io/harmoneasy/parts/v1/");
url.search = new URLSearchParams({
  midi: "midi/never-gonna-give-you-up.mid",
  outputs: "moog,speech-synthesis",
  transformers: "Transposer",
  config: JSON.stringify({
    devices: { "url-output-speech-synthesis": { volume: 0.7, interruption: false } },
    steps: { "url-chain": { "1": { distance: 12 } } }
  })
}).toString();
console.log(url.href);
```

App code can use `createPartsUrl(location, base, options, sourceRoute?)` from [parts-url.ts](../app/harmoneasy/source/services/parts-url.ts) to generate a versioned link. It escapes values and checks URL grammar; complete setup validation occurs when the link loads.

## Complete user-defined setups

Use `setup` for arbitrary routing, multiple chains or device instances, exact controller options, instrument/plugin definitions, surfaces, MIDI CC mappings and other exported workspace data. Supply the exported page object directly, not a preset-library wrapper or compressed `workspace:` string. JSON must use `format: "harmoneasy-preset"`, page `version: 1`, and workspace `version: 2`; required fields are shown below. Device and chain IDs must be unique, active/connection references must resolve, and transformer types must be supported.

This example shares one keyboard between two independently transposed voices, with speech on the lower voice:

```js
const steps = (distance) => JSON.stringify([
  JSON.stringify({ type: "Transposer", distance })
]);
const setup = {
  format: "harmoneasy-preset",
  version: 1,
  name: "Two voices and speech",
  description: "Play the keyboard to hear two octaves and a spoken note name.",
  clock: { bpm: 110, swing: 0, divisions: 24, bars: 4 },
  midiControls: { enabled: true, bindings: [] },
  workspace: {
    version: 2,
    activeChainId: "lower",
    devices: [
      { id: "keys", direction: "input", definition: { factory: "input", type: "keyboard" } },
      { id: "voice", direction: "output", definition: { factory: "output", type: "moog" } },
      { id: "speech", direction: "output", definition: { factory: "output", type: "speech-synthesis" } }
    ],
    chains: [
      { id: "lower", options: { name: "Lower", active: true }, inputs: ["keys"], outputs: ["voice", "speech"], transformers: steps(0) },
      { id: "upper", options: { name: "Upper", active: true }, inputs: ["keys"], outputs: ["voice"], transformers: steps(12) }
    ]
  }
};
const url = new URL("https://designerzen.github.io/harmoneasy/parts/v1/");
url.searchParams.set("setup", JSON.stringify(setup));
console.log(url.href); // Post or copy this URL.
```

To edit just one voice, append `chain=upper&transformers=Transposer&transformers-mode=replace` and configure its final step with `config.steps.upper`. To replace a preset with a full setup, add `setup=...` to its versioned URL; do not also supply `mode=replace` or `preset`.

Existing compressed room/setup sharing remains available for large exports. If `room-setup` is supplied alongside this API, the existing room setup takes priority when starting the application; use one workspace source per invitation to keep the result unambiguous. A `room` name alone can accompany any dynamic setup.

## Sharing limits and troubleshooting

- MIDI URLs must return MIDI bytes reachable by the recipient's browser; remote servers must permit the browser's cross-origin request. A page URL on a MIDI site is not necessarily a download URL. Local filesystem paths, `file:`, temporary `blob:` URLs and credentials in `midi=` are rejected. Uploads need a stable hosted URL before they can be shared by reference.
- A link preserves the configuration, not hardware, permissions, plugin installation, downloaded models or credentials. Unavailable hardware/plugins still follow the app's normal availability behaviour. Keep API keys and other private credentials out of shared options and exported data.
- `setup` and `config` each accept at most 65,536 decoded characters, nesting depth at most 32, and JSON data only; prototype-related properties and non-finite numbers are rejected. Browser/server/chat URL limits can be substantially lower. Use short preset-plus-override links for posting; use the existing export/file or compressed setup-sharing flow for larger workspaces.
- Queries and paths are visible to the host and may be included in link previews; they do not inherit the privacy properties of fragments. Keep existing pairing tokens in their established fragment format.
- A query URL's `&` separates parameters. In HTML attributes, write `&amp;`; in JavaScript use `URLSearchParams`; in Markdown links use normal `&`. Avoid double-encoding complete URLs or JSON.
- `midi` overrides a file, not tempo or rhythm by itself. Step playback follows playing actions; whole-file playback follows that file player's existing scheduling. Speech finishes naturally by default, but fast note changes can supersede prior speech according to the existing speech implementation.
- Invalid options appear as start-screen errors; they do not silently fall back to a different preset. A missing published route or failed preset fetch is an error. Remote BitMidi search and plugin/model downloads can still fail independently after a valid URL has been parsed.
