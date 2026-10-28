# HarmonEasy

> Play, transform, share and record music in the browser or Electron desktop app.

*Putting the Unity in Community*

[Live app](https://designerzen.github.io/harmoneasy/) · [Issues](https://github.com/designerzen/harmoneasy/issues) · [Discussions](https://github.com/designerzen/harmoneasy/discussions)

HarmonEasy connects musical inputs to instruments, MIDI devices, notation, speech and haptics through editable transformation chains. Use it to harmonise live playing, build chord and arpeggio patterns, remix imported notes, explore alternative controllers, make accessible musical feedback, or play together in a shared room.

## Getting started

1. Open the app and choose a starting context, a preset, or an empty setup. Starting contexts cover live playing, songwriting, learning, accessibility, file conversion, collaboration and genre sketches.
2. Add an input and an output to a chain. Start with Keyboard or Onscreen Keyboard and an instrument such as Moog or Piano.
3. Add and configure transformers in the graph. Use **Harmoniser** to keep pitches in a key or mode, **Chordifier** to expand notes into chords, and **Quantise** to align playback to the timing grid.
4. Adjust tempo, swing, clock source and device controls, then play. Create additional chains to build parallel parts and route devices to more than one chain.
5. Save a preset or complete setup, share a setup link, export captured musical events, or add a Recorder output to capture the master audio as WAV.

Use **Ctrl+K** (Windows/Linux) or **Cmd+K** (macOS) to search available commands and edit controls from the command palette. Device choices depend on the APIs and hardware available in the current environment.

## Workspace and performance capabilities

- **Multiple chains:** create, name, select, enable and configure independent input/transformer/output chains in a node graph; share input and output device instances across chains.
- **Musical transformations:** reorder and configure pitch, harmony, timing, duration, routing, variation and generative processing. Transformer order changes the result.
- **Presets and setups:** browse the built-in library, save chain presets and whole workspaces, recall them, and import/export preset libraries as JSON. Workspace configuration and app settings persist locally.
- **Starting contexts:** ready-made setups for accessible feedback, classroom improvisation, live harmony, bass lines, arpeggios, conversion/remixing and genre-based writing with instruments and drum accompaniment.
- **MIDI devices and control:** select ports and channels, discover known hardware profiles, learn MIDI CC assignments, configure bindings, and control application/device parameters. Unmapped messages continue to instruments.
- **Transport and timing:** play, stop, rewind, panic, tempo, swing, metronome, and internal, shared-room, external MIDI or manual clock sources.
- **Visual feedback:** onscreen keyboard, note and timeline visualisers, notation, chord descriptions, spectrum/waveform analysis and audio-reactive visuals.
- **Sound and plugins:** synthesizers, sample-based instruments, WAM/WAM2 hosting, WebCLAP instruments and mixer effects, plus master volume and reverb.
- **Recording and exchange:** capture processed musical events for notation/DAW exports and record the master audio separately for WAV playback and download.
- **Collaboration:** share notes, transport, tempo, swing and workspace configuration between connected browsers, with each participant rendering sound locally.
- **Interface:** searchable device/preset browsers, device control panels, a command palette and theme controls.

### MIDI control defaults

Connect a MIDI input to a chain before using MIDI control. Default bindings use channel 16: CC 7 volume, CC 20 tempo, CC 21 metronome, CC 22 play, CC 23 stop, CC 24 rewind and CC 123 panic. The MIDI control panel supports Learn, manual CC/channel/source assignments and removing bindings; learned settings persist locally. Mapped CC messages are consumed, and button bindings trigger at values 64–127 after release below 64.

## Inputs

These are the built-in input factory IDs, plus the hardware profiles registered dynamically. File imports and plugin bundles are covered separately below.

| Input | ID | Capability and requirements |
| --- | --- | --- |
| Keyboard | `keyboard` | Play notes from a computer QWERTY keyboard. |
| Onscreen Keyboard | `onscreen-keyboard` | Play the virtual keyboard with pointer/touch input. |
| MIDI File | `midi-file` | Load Standard MIDI File notes as a playable input in the active chain. |
| WebMIDI Device | `webmidi` | Receive hardware/virtual MIDI through Web MIDI; requires API support and permission. |
| Native MIDI Device | `native-midi` | Receive MIDI through native OS adapters; requires a working native runtime/addon. |
| MIDI 2.0 Native | `midi2-native` | Native MIDI 2.0 input with high-resolution/per-note data where supported by the backend and device. |
| BLE MIDI | `ble-midi` | Receive Bluetooth LE MIDI; requires Web Bluetooth support and a compatible device. |
| Gamepad | `gamepad` | Map controller buttons/axes to musical input through the Gamepad API. |
| Gamepad Music Controller | `gamepad-music` | Chord, melodic, drum and arpeggiator controller modes. |
| Microphone Formant | `microphone-formant` | Analyse microphone formants; requires microphone access. |
| Microphone Pitch (ML) | `microphone-pitch` | Detect polyphonic pitches with Spotify Basic Pitch; requires microphone access and model loading. |
| Leap Motion | `leap-motion` | Hand-gesture input; requires Leap hardware and the Leap runtime exposed to the app. |
| Music Mouse | `music-mouse` | Cursor-controlled musical instrument inspired by Laurie Spiegel's Music Mouse. |
| PromptAI Generator | `prompt-ai` | Generate note sequences from text via an external AI API; requires an API key configured in input options, network access and a supported model. |
| PromptAI Speech | `prompt-ai-speech` | Speech-recognised prompts for AI note generation; additionally requires browser speech recognition. |
| MIDI Transport Clock | `midi-transport-clock` | MIDI clock/transport input, using 24 clock pulses per quarter note. |
| DVS Control Vinyl | `dvs-control-vinyl` | Estimate relative speed from a microphone/audio-input pilot tone and generate DVS or MIDI clock. Does not decode direction or absolute record position. |

### Hardware-specific MIDI inputs

The profile registry adds named inputs with device metadata and controls, matched to connected ports. The repository currently includes:

| Device | Profile ID |
| --- | --- |
| Akai MPK mini mk3 | `akai-mpk-mini-mk3` |
| Arcana Strum | `arcana-strum` |
| Arturia MiniLab 3 | `arturia-minilab-3` |
| DIGIT CMPSR | `digit-cmpsr` |
| Korg minilogue | `korg-minilogue` |
| Novation Launchkey Mini MK3 | `novation-launchkey-mini-mk3` |
| Roland A-49 | `roland-a-49` |
| Yamaha reface CS | `yamaha-reface-cs` |

Profiles are loaded from the device registry at runtime; additional profiles can be discovered without changing the generic input IDs. Generic MIDI inputs remain available for other hardware.

## Transformers

The selectable transformer factory provides the following processing types. These operate on musical commands; Note Delay and Note Reverb, for example, generate or schedule note events rather than processing recorded audio.

| Transformer | Capability |
| --- | --- |
| Arpeggiator | Turn held notes/chords into patterns of individual notes. |
| Channeler | Route musical events to a chosen MIDI channel. |
| Chordifier | Expand individual notes into chords. |
| Constrictor | Limit notes to a configured pitch range. |
| Emoji | Transform notes using emoji-based patterns. |
| Filter | Pass or block musical events according to configured criteria. |
| Harmoniser | Move pitches into the selected root/key and scale or mode. |
| Magenta Melody | Generate accompaniment conditioned on played notes and harmony; generation runs in a worker and first use downloads model weights. Original notes continue through. |
| Microtonality | Apply microtuning from large/small-step scale definitions and a reference frequency; audible results depend on output tuning/pitch-bend support. |
| MIDI File Player | Play notes from a loaded MIDI file within a transformation chain. |
| Note Delay | Delay musical events. |
| Note Repeater | Generate repeated notes. |
| Note Reverb | Repeat notes at intervals with progressively lower velocities. |
| Note Shortener | Shorten notes for staccato articulation. |
| Quantise | Lock playback to a rhythmic grid. |
| Randomiser | Add controlled variation to note parameters. |
| Timing Humaniser | Add timing variation. |
| Transposer | Shift pitches by an interval. |
| Vibrator | Apply pitch vibrato; distinct from the haptic output. |

The engine also includes Identity (pass-through), Swinger and Kill Old note-cleanup utilities. They are separate from the selectable transformer factory inventory above. Scale/mode and interval utilities live in `audiobus` and `pitfalls`; the Harmoniser includes the seven diatonic modes, and microtonal tuning uses configurable step patterns.

## Outputs

All built-in output types are listed here. Plugin-specific outputs follow in the next section; an output can produce audio, MIDI, visual information, haptics or a recording control surface.

| Output | ID | Capability and requirements |
| --- | --- | --- |
| Recorder | `recorder` | Record and review the app's master audio, then export WAV. All Recorder outputs share one recording session. |
| Moog | `moog` | Photosynth MoogFF ladder synthesizer with MIDI and WAM2 controls. |
| TB-303 | `tb303` | Monophonic acid bass with nonlinear diode ladder, pitch slide and accents. |
| Drum Accompaniment | `drum-accompaniment` | Clocked drum grooves with note-activity variations, tuning and compression. |
| Pink Trombone | `pink-trombone` | Vocal-tract synthesis with speech-like sounds. |
| Yoshimi | `yoshimi` | Software synthesizer with instrument presets. |
| Supersonic | `supersonic` | SuperCollider-based synthesis engine; requires its runtime assets. |
| WAM2 | `wam2` | Host a Web Audio Modules 2 instrument by plugin URL. |
| WAM | `wam` | Host the legacy Yoshimi and webDX7 modules. |
| WebMIDI Device | `webmidi` | Send MIDI to hardware or virtual ports using Web MIDI. |
| Native MIDI Device | `native-midi` | Send MIDI through native OS adapters. |
| BLE MIDI | `ble-midi` | Send MIDI to compatible Bluetooth LE devices. |
| MIDI 2.0 | `midi2` | Send Universal MIDI Packets through the native MIDI 2.0 module. |
| MIDI 2.0 Native | `midi2-native` | Native MIDI 2.0 output with high-resolution/per-note controls where supported. |
| Describe | `describe` | Describe notes, chords, extensions and inversions in text, with screen reader announcements. |
| Notation | `notation` | Display notes on a musical staff. |
| Spectrum Analyser | `spectrum-analyser` | FFT spectrum and realtime waveform display from the audio mix. |
| Butterchurn | `butterchurn` | WebGL audio-reactive visualisation. |
| Speech Synthesis | `speech-synthesis` | Speak/sing note names using speech synthesis. |
| Vibrator | `vibrator` | Trigger device or supported gamepad haptics for notes in a configured range. |
| Metronome | `metronome` | Produce audible clicks in response to MIDI clock. |
| Audio Click | `audio-click` | Play a selected click asset on each bar. |
| Console | `console` | Log musical events to the browser console; development mode only. |

Native MIDI and MIDI 2.0 entries require working native modules and compatible OS/device support; being listed in a picker does not make them available in a regular web browser. Instrument, analyser and recorder outputs also require the appropriate audio context/mixer supplied by the app.

### WAM2 instrument outputs

The bundled registry exposes each of these directly in the output picker, using `wam2:<identifier>`:

| Instrument | Identifier |
| --- | --- |
| Soundfont Player | `com.sequencerParty.soundfont` |
| Audio Track (recorder/player/looper) | `com.sequencerParty.audioTrack` |
| DRM-16 DrumComputer | `com.sequencerParty.drumComputer` |
| Spectrum: Modal | `com.sequencerParty.modal` |
| Synth-101 | `com.sequencerParty.synth101` |
| TinySynth (no GUI) | `com.webaudiomodules.wam-examples.tinysynth` |
| WamExample | `com.webaudiomodules.wam-examples.wam-example` |
| OBXD | `org.webaudiomodules.obxd` |
| Faust Flute MIDI | `com.webaudiomodules.wam-examples.faust-flute` |

The WAM2 registry also supports online discovery/search by category. Bundled metadata makes entries discoverable without a successful registry fetch; plugin code, samples and other assets may still require network access. You can also drop an HTTP(S) plugin directory, `index.js`/`.mjs` URL or `descriptor.json` URL, or import a ZIP containing a complete built WAM2 instrument. A gallery/documentation URL or a standalone local JavaScript file is not a plugin bundle.

### WebCLAP instruments and mixer effects

WebCLAP instrument outputs use `webclap:<plugin-id>`. The bundled instrument catalogue contains **C++ Example Synth**, **Clack PolySynth Example**, **Organ**, **Piano**, **Pulze**, **Synome**, **Synth (AssemblyScript)**, **OB-Xf**, **Six Sines**, **RipplerX**, **Odin 2** and **Surge XT**. Pulze starts with empty pads and needs samples loaded before it makes sound. See the [catalogue](packages/audiobus/instruments/clap/clap-catalog.ts) for exact IDs, descriptions, authors and licenses.

The WebCLAP catalogue also includes mixer inserts: **[Basics] Analyser**, **[Basics] Chorus**, **[Basics] Crunch**, **[Basics] Frequency Shifter**, **[Basics] Limiter**, **[Basics] Reverb**, **Auto-Pan**, **Brick Limiter**, **C++ Example Audio Plugin (Chorus)**, **Chorus**, **Clack Gain Example**, **Compressor**, **Delay**, **Esscape**, **Gain (AssemblyScript)**, **Parametric EQ**, **Reverb**, **Saturation**, **Spectrum**, **Vocal Limiter** and **Polarity SC Dark**. These are effects/analysis entries, rather than separate instrument output factories. WebCLAP requires WebAssembly, AudioWorklet and the corresponding plugin assets.

## Import, export and recording

### Imports

Use Import or drag files onto the app. Imported musical data goes through the active chain, so the chosen transformations and outputs affect playback and subsequent event capture.

| Input format | Behaviour |
| --- | --- |
| Standard MIDI File (`.mid`, `.midi`) | Load notes into a MIDI File input on the active chain. |
| MusicXML (`.musicxml`, `.xml`) | Convert score data into scheduled musical commands. |
| DawProject (`.dawproject`) | Import musical project data as commands for the chain. |
| Tracker files | The import UI accepts `.mod`, `.xm`, `.it`, `.s3m`, `.669`, `.far`, `.stm`, `.ult`, `.mtm`, `.dmf`, `.ptm`, `.okt`, `.mptm` and `.nst`; the current parser is limited and does not provide complete playback/import fidelity for this list. |
| ZIP archives | Inspect for MIDI files or a built WAM2 instrument; when several instruments exist, choose one to load. |
| Hosted WAM/WAM2 URLs | Load a plugin as an output; legacy module URLs are also recognised. |
| Preset/setup JSON | Import through the preset library to reuse chain presets and complete setups. |

The media importer limits individual files to 64 MB. Score/project imports exchange musical events, not a guaranteed reconstruction of every source instrument, sample, effect or automation lane. Tracker support is particularly incomplete: accepted extensions should not be read as a compatibility guarantee.

### Exports and integrations

The Export menu operates on captured musical events. Play imported material through a chain to capture the part you want to export.

| Output format/integration | Result |
| --- | --- |
| MIDI | Standard MIDI File for hardware sequencers and DAWs. |
| MED | Tracker-oriented MED file export. |
| MIDI Markdown | Text representation of the recorded musical events. |
| MusicXML | Score interchange for notation applications. |
| VexFlow | Rendered notation preview with downloadable HTML. |
| DawProject | `.dawproject` project interchange export. |
| OpenDAW | Generated project-creation script shown in a copyable dialog; paste and run it in OpenDAW. |
| Audiotool | Connect through the Audiotool panel and send captured takes into a project; requires the external service/connection. |
| WAV | Master audio recording, reviewed and downloaded through Recorder controls. |
| Preset/setup JSON | Download individual saved presets/setups or a reusable preset library. |
| Setup/room links and QR codes | Share the current workspace or exchange invitations to connect browsers. |

### Audio recording and persistence

Add a **Recorder** output, start recording, then stop to review and save the take. Recording captures the app's master audio mix as stereo WAV, with **16-bit PCM** or **32-bit float** export and RF64 headers for very large files. It captures sound routed through that mix; external MIDI hardware audio must be brought into an audio path separately.

Recorder outputs share one session, and the next recording replaces the previous take. OPFS-backed recording keeps audio in browser storage and can recover a retained take; when OPFS is unavailable, recording falls back to memory with a 64 MB cap. Export takes you want to keep before replacing them or clearing browser storage.

Musical event capture is separate from audio recording and supplies MIDI, score and project exports. The app also uses OPFS for event storage when available, and local browser storage for workspace/settings/preset persistence; these are local features, not a cloud account or backup service.

## Playing together and clock sources

Open **Sync** to start or join a room. The host creates an invitation link/QR, the joining player opens it and sends a reply, and the host applies that reply to complete the connection. A copied setup link restores instruments and chains; joining live playback requires the invitation/reply connection.

Connected rooms use WebRTC data channels and Netronome session timing to share notes, transport, tempo, swing and workspace edits. Participants load the shared instruments/chains and render sound on their own device. Shared playback waits for workspace loading and clock synchronization; unavailable devices/plugins can pause a participant's shared playback. The room supports conductor handover if the current conductor leaves.

Clock sources are **Internal** (local timer), **Shared** (room timing), **MIDI** (follow a connected MIDI input's clock/transport) and **Manual** (external/manual triggering). Connect a MIDI input before selecting MIDI clock. Room connections depend on peer connectivity and network conditions; this is musical-event collaboration rather than streamed remote audio, and latency-free playback is not guaranteed.

## Browser and desktop requirements

Use a current browser with Web Audio support and start audio through a user gesture. Features are detected at runtime; support differs by browser, OS, permissions and hardware.

- **Hardware MIDI:** Web MIDI and permission in the browser; native OS adapters require the native/Electron runtime and built addons.
- **Bluetooth:** Web Bluetooth, compatible BLE MIDI hardware, a secure context and user permission.
- **Microphones:** media device capture permission and a secure context. ML pitch input additionally loads its model.
- **Plugins:** AudioWorklet/WebAssembly and plugin assets; some engines need cross-origin isolation/SharedArrayBuffer support. Network access may be needed for plugins, samples and ML weights.
- **Speech/gestures/haptics:** the relevant speech APIs, Leap runtime or vibration/gamepad support. These are not universal browser capabilities.
- **Persistence:** OPFS availability and browser storage quota determine file-backed storage; local settings/presets remain tied to the browser profile/origin.
- **Rooms:** WebRTC data channels and a network path between peers.
- **Desktop builds:** native compiler/toolchain and platform SDKs for node-gyp, in addition to Electron's build requirements.

## Development

### Setup

Use a Node.js version supported by the declared Vite 8/Electron tooling and the pnpm version pinned in [package.json](package.json) (`pnpm@12.0.0`).

```bash
git clone --recurse-submodules https://github.com/designerzen/harmoneasy.git
cd harmoneasy
pnpm install
pnpm run dev
```

The web app's configured development port is **1999**: `http://localhost:1999`. Installation runs a postinstall script that initializes/updates Git submodules with `--remote`, so Git and network access are required.

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Run workspace development tasks through Turbo. |
| `pnpm --dir app/harmoneasy run dev` | Run the web app directly. |
| `pnpm run build` | Build workspace packages and the web app; app output is `app/harmoneasy/dist/`. |
| `pnpm --dir app/harmoneasy run preview` | Preview the web app's production build. |
| `pnpm test` | Run workspace test tasks. |
| `pnpm --dir app/harmoneasy exec vitest run` | Run app tests once. |
| `pnpm run type-check` | Run declared workspace type-check tasks. |
| `pnpm run lint` | Run declared workspace lint tasks. |
| `pnpm --dir app/harmoneasy run dev:electron` | Start Vite and Electron together. |
| `pnpm run build:electron` | Build native addons, bundle and package the desktop app into `app/harmoneasy/dist-electron/`. |

Electron packaging targets Windows NSIS/portable, macOS DMG/ZIP and Linux AppImage/DEB. Availability of native MIDI features must be checked on the intended platform; packaging targets do not imply every native backend is functional there.

### Architecture and source map

Inputs emit unified `AudioCommand` events. `IOChainManager` owns multiple chains and shared device instances; each `IOChain` schedules and transforms commands and routes them to its outputs. Netronome supplies timing. Audio-producing outputs feed the mixer, while MIDI, notation, descriptions and haptics have their own destinations. Event capture and master-audio capture support different export paths.

| Location | Responsibility |
| --- | --- |
| `app/harmoneasy/source/index.ts` | Startup, transport, event recording, imports and export integrations. |
| `app/harmoneasy/source/components/graph/` | React graph, device routing UI, preset browser and workspace controls. |
| `app/harmoneasy/source/services/` | Rooms, clock sources, audio recording, MIDI controls, media import, themes and command palette. |
| `app/harmoneasy/electron/` | Desktop main/preload integration. |
| `packages/audiobus/` | Musical commands, chains, factories, transformers, instruments, MIDI, import/export, visualisation and storage. |
| `packages/audiobus/midi/hardware/devices/` | Hardware profile JSON, metadata and assets. |
| `packages/netronome/` | Timing/session synchronization and audio worklet support. |
| `packages/midi-ble/` | Bluetooth MIDI support. |
| `packages/pitfalls/` | Music theory and tuning utilities. |
| `packages/audiotool/` | Audiotool integration. |
| `packages/openDAW/` | OpenDAW export integration. |
| `packages/pink-trombone/`, `packages/flodjs/` | Vocal synthesis and tracker-related libraries. |
| `app/harmoneasy/tests/` | App tests; packages also contain their own tests. |

The stack uses TypeScript, Vite, pnpm workspaces, Turbo, Web Audio, SCSS, Vitest and Electron. React is reserved for the graph; surrounding application UI follows the established non-React patterns.

When adding capabilities, update the relevant [input definitions](packages/audiobus/io/input-definitions.ts), [output definitions](packages/audiobus/io/output-definitions.ts), [transformer factory](packages/audiobus/io/transformer-factory.ts), plugin catalogue or hardware profile registry as appropriate. Factories lazy-load devices; their API checks are an initial filter, with connection/runtime requirements checked later.

Read [CODING_STANDARDS.md](CODING_STANDARDS.md) before implementing or reviewing changes. Reuse shared event constants, follow the graph/UI boundary, run checks appropriate to the change, and update this inventory when user-facing capabilities change.

## Credits and support

HarmonEasy builds on Web Audio, Web MIDI, Web Bluetooth, Netronome, Web Audio Modules, WebCLAP, VexFlow, Pink Trombone, Spotify Basic Pitch, Magenta, SuperCollider/Supersonic, Audiotool and OpenDAW. The app's About/credits information and plugin catalogue include component attributions; bundled third-party assets retain their own licenses.

Report bugs and request features through [GitHub Issues](https://github.com/designerzen/harmoneasy/issues), join [Discussions](https://github.com/designerzen/harmoneasy/discussions), or [contact the maintainer](mailto:radio@awesomething.co.uk).
