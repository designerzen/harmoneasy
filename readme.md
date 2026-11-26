# HarmonEasy

> Play, transform, share and record music in the browser or Electron desktop app.

*Putting the Unity in Community*

[Live app](https://designerzen.github.io/harmoneasy/) · [Issues](https://github.com/designerzen/harmoneasy/issues) · [Discussions](https://github.com/designerzen/harmoneasy/discussions)

[Preset URL API guide](docs/preset-url-api.md): build and share custom setups with `/parts/v1/`, extend any preset, or supply a complete workspace through query parameters. Includes clickable examples for MIDI, speech, ensembles and multi-chain setups.

[AI agent documentation](https://designerzen.github.io/harmoneasy/docs/ai/) provides the generated component reference, preset recipes and [every package's documentation](https://designerzen.github.io/harmoneasy/docs/ai/packages/). The site also publishes `llms.txt`, individual component references and a package JSON catalog with manifest versions, exports and checkout provenance.

[audioBus Protocol guide](docs/audiobus-protocol.md): play and control HarmonEasy from another web page or application: notes, transport, presets and every on-screen control. Try it in the [remote control demo](https://designerzen.github.io/harmoneasy/protocol-remote.html).

### Test remote control

| Live page | What to try |
| --- | --- |
| [Protocol-site HarmonEasy remote](https://designerzen.github.io/audiobus-protocol/api/remote-control.html) | Press Start inside the embedded app; the remote connects automatically. Play keyboard/drums, change tempo, load presets, and edit discovered commands, properties and palette controls. |
| [Step through a song](https://designerzen.github.io/harmoneasy/presets/protocol/step-song/) | Any incoming note advances the song; its configured Protocol Output sends resulting notes back. |
| [Remote playground](https://designerzen.github.io/harmoneasy/presets/protocol/remote-playground/) | Test MIDI through a ready-made instrument chain. |
| [Protocol demo catalogue](https://designerzen.github.io/audiobus-protocol/demos.html) | Test symmetric commands, optional pairing, legacy MIDI, MIDI 2 UMP and properties. |

For your current setup, add an **audioBus Protocol** Input to the desired chain and press the toolbar's **Remote** button. Open connections are the default; pairing lives in advanced settings. The remote discovers what your current setup exposes. For local development, use [the protocol-site remote targeting localhost](https://designerzen.github.io/audiobus-protocol/api/remote-control.html?app=http://localhost:1999/).

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

These are common input factory IDs; the deployed [AI component reference](https://designerzen.github.io/harmoneasy/docs/ai/) is generated from the full current registries, including hardware profiles. File imports and plugin bundles are covered separately below.

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
| PromptAI Generator | `prompt-ai` | Generate loops from text using supported built-in browser AI; no API key. First use can require a model download. |
| PromptAI Speech | `prompt-ai-speech` | Speech-recognised prompts for AI note generation; additionally requires browser speech recognition. |
| MIDI Transport Clock | `midi-transport-clock` | MIDI clock/transport input, using 24 clock pulses per quarter note. |
| audioBus Protocol | `protocol` | Receive notes and commands from other web pages and applications; see [Remote control](#remote-control-audiobus-protocol). |
| DVS Control Vinyl | `dvs-control-vinyl` | Track the 1 kHz pilot tone of a Serato v2 control vinyl/CD and emit 24 musical ticks per beat of a reference BPM (at normal speed) plus start/stop. Select "DVS control vinyl" in the clock source to let the platter drive the transport clock; speed changes follow the tempo. With a stereo input, reverse play holds the clock (`invertDirection` swaps forward and reverse). Does not decode absolute record position. |

### Hardware-specific MIDI inputs

The profile registry adds named inputs with device metadata and controls, matched to connected ports. Examples include:

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

The selectable transformer factory includes the following common processing types; consult the generated [complete reference](https://designerzen.github.io/harmoneasy/docs/ai/) for the current inventory and exact IDs. These operate on musical commands; Note Delay and Note Reverb, for example, generate or schedule note events rather than processing recorded audio.

| Transformer | Capability |
| --- | --- |
| Arpeggiator | Turn held notes/chords into patterns of individual notes. |
| Bernoulli Gate | Toss a coin per note or chord to route it to channel A or B, or toggle sides; after Mutable Instruments Branches. |
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
| Random Sampler | Generate random gates and in-scale pitches around held notes with spread, bias, steps and Déjà vu loops; ported from Mutable Instruments Marbles (MIT). |
| Randomiser | Add controlled variation to note parameters. |
| Timing Humaniser | Current source applies a pitch offset and exposes no timing-jitter controls; use Timing Humaniser's source/reference before relying on its name. |
| Topographic Drums | Hold a note to play kick, snare and hi-hat patterns morphed across an X/Y map with per-voice density and chaos; modelled on Mutable Instruments Grids with an original pattern map. |
| Transposer | Shift pitches by an interval. |
| Vibrator | Apply pitch vibrato; distinct from the haptic output. |

The engine also includes Identity (pass-through), Swinger and Kill Old note-cleanup utilities. They are separate from the selectable transformer factory inventory above. Scale/mode and interval utilities live in `audiobus` and `pitfalls`; the Harmoniser includes the seven diatonic modes, and microtonal tuning uses configurable step patterns.

## Outputs

Common output types are listed here. The generated component reference includes the full output, instrument and effect inventories. Plugin-specific outputs follow below; an output can produce audio, MIDI, visual information, haptics or a recording control surface.

| Output | ID | Capability and requirements |
| --- | --- | --- |
| audioBus Protocol | `protocol` | Send the chain's MIDI to a paired application, and optionally to every page controlling HarmonEasy; see [Remote control](#remote-control-audiobus-protocol). |
| Recorder | `recorder` | Record and review the app's master audio, then export WAV. All Recorder outputs share one recording session. |
| Moog | `moog` | Photosynth MoogFF ladder synthesizer with MIDI and WAM2 controls. |
| TB-303 | `tb303` | Monophonic acid bass with nonlinear diode ladder, pitch slide and accents. |
| Drum Accompaniment | `drum-accompaniment` | Clocked drum grooves with note-activity variations, tuning and compression. |
| Pink Trombone | `pink-trombone` | Vocal-tract synthesis with speech-like sounds. |
| Voice Workshop | `voice-workshop` | Physically modelled singing voice with a vowel pad and live vocal-tract view. |
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

Use **Import File** or drag files onto the app. The importer checks file contents before falling back to the filename, previews the detected format, and loads musical data as a saved playable input on the active chain. The chosen transformations and outputs affect playback and subsequent event capture.

| Input format | Behaviour |
| --- | --- |
| Standard MIDI File / karaoke (`.mid`, `.midi`, `.kar`) | Import MIDI notes, channels, programs and timing. |
| RIFF MIDI (`.rmi`, `.rmid`) | Import MIDI from a RIFF container. |
| MusicXML (`.musicxml`, `.xml`) and compressed MusicXML (`.mxl`) | Convert score notes, voices and timing to musical commands. |
| MuseScore 3/4 (`.mscx`, `.mscz`) | Load written notes, ties, tuplets and tempo changes; repeats and ornaments are not expanded. |
| Guitar Pro 3–8 (`.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp`) | Import tablature/score notes through alphaTab. |
| Capella (`.capx`) | Import compressed Capella scores. |
| alphaTex (`.atex`, `.alphatex`) | Import text scores. |
| ABC notation (`.abc`) | Import notation as playable notes. |
| Core MML (`.mml`) | Import the supported core Music Macro Language note syntax. |
| RTTTL (`.rtttl`, `.rtx`) | Import ringtone melodies. |
| MIDI CSV (`.csv`) | Import MIDI event CSV with tempo and channel data. |
| Magenta NoteSequence (`.json`, `.noteseq`) | Import seconds-based or quantized NoteSequence JSON. Generic JSON is not accepted as a score. |
| Tone.js MIDI JSON (`.tone.json`) | Import serialized Tone.js MIDI tracks. |
| JAMS (`.jams`) | Import note annotations. |
| Sonic Visualiser (`.svl`) | Import note layers. |
| UTAU (`.ust`) | Import melody notes and timing. |
| Synthesizer V (`.svp`) | Import vocal note projects, including tempo changes. |
| OpenUtau (`.ustx`) | Import vocal note projects. |
| UtaFormatix (`.ufdata`) | Import vocal note interchange data. |
| LMMS (`.mmp`, `.mpt`, `.mmpz`) | Import song-level piano-roll patterns at a fixed tempo; compressed projects are supported. |
| REAPER (`.rpp`) | Import embedded MIDI, tempo maps, loops and integer take transposition. Glue slip-edited clips and crop items to their active take first; external MIDI files are not followed. |
| DAWproject (`.dawproject`) | Import musical project data as commands for the chain. |
| Tracker modules and packed modules | Import the 70 extensions listed below through the bundled libopenmpt decoder. |
| Audio (`.wav`, `.mp3`, `.ogg`, `.oga`, `.opus`, `.flac`, `.m4a`, `.aac`, `.aif`, `.aiff`, `.webm`) | Load into a Loop Player; decoding depends on browser codec support. |
| SoundFont (`.sf2`, `.sf3`) and MIDI.js soundfonts | Choose which Romplers play the soundfont, or add a new Rompler to the chain in focus; soundfonts may be up to 1 GB. |
| Instrument/MIDI bundles (`.zip`, `.wam`, `.wam2`) | Inspect for MIDI files or a built WAM2 instrument; when several instruments exist, choose one to load. |
| Hosted WAM/WAM2 URLs | Load a plugin as an output; legacy module URLs are also recognised. |
| Preset/setup JSON | Import through the preset library to reuse chain presets and complete setups. |

The media importer limits individual files to 64 MB; audio loops are limited to 4 MB. Score/project imports exchange musical events, not a reconstruction of every source instrument, sample, effect or automation lane. Vocal imports load notes rather than synthesized singing.

#### Tracker import coverage

The file picker and automatic importer expose every extension reported by the bundled decoder:

| Family | Extensions |
| --- | --- |
| Main tracker formats | `.mod`, `.xm`, `.it`, `.s3m`, `.mptm`, `.med` |
| Other tracker formats and variants | `.667`, `.669`, `.amf`, `.ams`, `.c67`, `.cba`, `.dbm`, `.digi`, `.dmf`, `.dsm`, `.dsym`, `.dtm`, `.etx`, `.far`, `.fc`, `.fc13`, `.fc14`, `.fmt`, `.fst`, `.ftm`, `.gdm`, `.gmc`, `.gt2`, `.gtk`, `.ice`, `.imf`, `.ims`, `.j2b`, `.m15`, `.mdl`, `.mms`, `.mt2`, `.mtm`, `.mus`, `.nst`, `.okt`, `.plm`, `.psm`, `.pt36`, `.ptm`, `.puma`, `.rtm`, `.sfx`, `.sfx2`, `.smod`, `.st26`, `.stk`, `.stm`, `.stp`, `.stx`, `.symmod`, `.tcb`, `.ult`, `.unic`, `.wow`, `.xmf` |
| Compressed modules / containers | `.mo3`, `.oxm`, `.umx`, `.xpk`, `.ppm`, `.mmcmp` |

Traditional Amiga names such as `mod.song` are also recognised. Decoder coverage is checked against the bundled WASM build, rather than assuming all formats in a newer library release are available; see the [libopenmpt format documentation](https://lib.openmpt.org/libopenmpt/faq/).

Tracker import extracts row notes, instruments and explicit volumes while following the decoder's order jumps, repeats and tempo/speed changes. It supports up to 192 tracks, 100,000 notes and 30 minutes per file. Tracks beyond 16 share MIDI channels cyclically but retain distinct source names. Instrument/sample indices become MIDI programs (clamped to 0–127); original samples, envelopes, pitch slides and other tracker effects are not reproduced. Packed files must be decodable by the bundled build; arbitrary archives and external sample dependencies are not resolved.

### Exports and integrations

Choose **Recording** or a **Loaded song** in the Export menu. A loaded song exports directly, without playing it into the recorder; VexFlow, openDAW and AudioTool always use the recording. MIDI, RIFF MIDI, Tone.js JSON, MusicXML/MXL, MuseScore and MIDI CSV keep tempo changes, time signatures, the key signature and track names; DAWproject and REAPER keep all but the key, and Synthesizer V, OpenUtau and UtaFormatix keep tempo changes and time signatures. Notation bar lines follow the time signatures. Formats with a single tempo, such as LMMS and tracker modules, use the first tempo and keep note timing.

| Output format/integration | Result |
| --- | --- |
| MIDI (`.mid`) | Standard MIDI File with one track per channel and program, keeping velocities, programs and tempo. |
| RIFF MIDI (`.rmi`) | MIDI wrapped in a RIFF container. |
| Tracker modules (`.med`, `.mod`, `.xm`, `.s3m`, `.it`, `.mtm`, `.dsm`, `.ult`, `.669`, `.okt`, `.stm`, `.amf`, `.ptm`) | Thirteen native module formats with embedded samples; see the tracker export limits below. Each instrument is sampled from its chain's audio output during export (the mix is muted briefly); instruments that cannot be sampled use a synthesised General MIDI approximation, with separate drum sounds for channel 10. |
| MuseScore 4 (`.mscx`, `.mscz`) | Measured score with rests and ties in 4/4. |
| MIDI Markdown (`.md`) | Text representation of the recorded musical events. |
| MusicXML | Score interchange for notation applications. |
| Compressed MusicXML (`.mxl`) | ZIP-packaged MusicXML score. |
| Guitar Pro 7 (`.gp`) / alphaTex (`.atex`) | Export captured notes as a score or text score. |
| ABC (`.abc`) | Text notation export. |
| MIDI CSV (`.csv`) | MIDI event table export. |
| Core MML (`.mml`) / RTTTL (`.rtttl`) | Text melody export; RTTTL requires a single melody. |
| LilyPond (`.ly`) | Notation source export. |
| Magenta NoteSequence (`.notes.json`) | Note sequence JSON export. |
| Tone.js MIDI JSON (`.tone.json`) | Serialized MIDI tracks. |
| JAMS (`.jams`) / Sonic Visualiser (`.svl`) | Note annotation/layer export. |
| UTAU (`.ust`) | Single-voice melody project. |
| Synthesizer V (`.svp`) / OpenUtau (`.ustx`) / UtaFormatix (`.ufdata`) | Vocal note projects with placeholder “a” lyrics and no assigned singer. |
| LMMS (`.mmp`, `.mmpz`) | Song note projects using a basic oscillator, optionally compressed. |
| REAPER (`.rpp`) | Self-contained project with editable embedded MIDI and named tracks; instruments and effects are not included. |
| VexFlow (`.html`) | Rendered notation preview with downloadable HTML. |
| DawProject | `.dawproject` project interchange export. |
| OpenDAW | Generated project-creation script shown in a copyable dialog; paste and run it in OpenDAW. |
| Audiotool | Connect through the Audiotool panel and send captured takes into a project; requires the external service/connection. |
| WAV (`.wav`) | Master audio recording, exported as 16-bit PCM or 32-bit float through Recorder controls. |
| WebM/Opus (`.webm`), Ogg/Opus (`.ogg`), M4A/AAC (`.m4a`) | Compressed audio exports through Recorder controls, available when the browser supports the encoder. |
| Preset/setup JSON | Download individual saved presets/setups or a reusable preset library. |
| Setup/room links and QR codes | Share the current workspace or exchange invitations to connect browsers. |

#### Tracker export limits

| Format | Channels | Instruments | Notes |
| --- | --- | --- | --- |
| OctaMED (`.med`) | 64 | 63 | Embedded samples. |
| ProTracker (`.mod`) | 32 | 31 | Classic period-based pitch range. |
| FastTracker 2 (`.xm`) | 32 | 128 | Multisample instruments and release envelopes. |
| Scream Tracker 3 (`.s3m`) | 32 | 99 | Embedded PCM samples. |
| Impulse Tracker (`.it`) | 64 | 99 | Multisample instruments and release envelopes. |
| MultiTracker (`.mtm`) | 32 | 63 | Native tracks and pattern maps, 8-bit samples. |
| DSIK (`.dsm`) | 16 | 64 | RIFF-based DSM v2 with embedded 8-bit samples. |
| UltraTracker (`.ult`) | 32 | 64 | ULT v4, two effect slots, embedded 8-bit samples. |
| Composer 669 (`.669`) | 8 | 64 | Fixed tempo 78; speed 1–15 determines row timing. Volume has 16 levels. |
| Oktalyzer (`.okt`) | 4 | 36 | Four hardware channels with 8-bit samples; fixed tempo 125 with variable speed. Samples are limited to 131,070 bytes each. |
| Scream Tracker 2 (`.stm`) | 4 | 31 | STM 2.21 with variable speed and the default ST2 tick rate; 64 distinct patterns and 65,535 bytes per sample. |
| ASYLUM (`.amf`) | 8 | 64 | ASYLUM Music Format v1.0 with 8-bit samples; not the separate DSMI AMF variant. |
| PolyTracker (`.ptm`) | 32 | 255 | PTM 2.03 with delta-encoded 8-bit samples; 128 pattern slots. |

All thirteen formats export recordings or loaded songs. Notes are snapped to tracker rows, pitches outside the format's range are octave-folded, and excessive polyphony, instrument counts or song length produce an error. Formats with fixed tempo use the nearest supported row duration, so 669, Oktalyzer and STM have coarser timing. MOD, MTM, ULT and PTM may insert a leading row when the first row has no room for the initial timing effects. The legacy formats carry one sample per instrument and cut notes at their ends; they do not carry plugin automation or release envelopes. These exports are native module files verified with libopenmpt; the larger tracker import list also contains formats that cannot be exported.

### Audio recording and persistence

Add a **Recorder** output, start recording, then stop to review and save the take. Recording captures the app's master audio mix as stereo WAV, with **16-bit PCM** or **32-bit float** export and RF64 headers for very large files. It captures sound routed through that mix; external MIDI hardware audio must be brought into an audio path separately.

Recorder outputs share one session, and the next recording replaces the previous take. OPFS-backed recording keeps audio in browser storage and can recover a retained take; when OPFS is unavailable, recording falls back to memory with a 64 MB cap. Export takes you want to keep before replacing them or clearing browser storage.

Musical event capture is separate from audio recording and supplies MIDI, score and project exports. The app also uses OPFS for event storage when available, and local browser storage for workspace/settings/preset persistence; these are local features, not a cloud account or backup service.

## Playing together and clock sources

Open **Sync** to start or join a room. The host creates an invitation link/QR, the joining player opens it and sends a reply, and the host applies that reply to complete the connection. A copied setup link restores instruments and chains; joining live playback requires the invitation/reply connection.

Connected rooms use WebRTC data channels and Netronome session timing to share notes, transport, tempo, swing and workspace edits. Participants load the shared instruments/chains and render sound on their own device. Shared playback waits for workspace loading and clock synchronization; unavailable devices/plugins can pause a participant's shared playback. The room supports conductor handover if the current conductor leaves.

Clock sources are **Internal** (local timer), **Shared** (room timing), **MIDI** (follow a connected MIDI input's clock/transport) and **Manual** (external/manual triggering). Connect a MIDI input before selecting MIDI clock. Room connections depend on peer connectivity and network conditions; this is musical-event collaboration rather than streamed remote audio, and latency-free playback is not guaranteed.

## Remote control (audioBus Protocol)

Any web page or application can play and control HarmonEasy through [audioBus Protocol](docs/audiobus-protocol.md): MIDI notes and controllers, the transport and tempo, loading presets, and every button, switch, choice and slider the command palette can reach. Add an **audioBus Protocol** input to a chain to accept control; add an **audioBus Protocol** output with **Also send to applications connected to this window** to send the chain's notes back to those pages.

Press **Remote** in the toolbar to open the remote control demo in a window connected to the running app, or open the demo pages directly:

| Demo | Local development | What to try |
| --- | --- | --- |
| Remote control | [`/protocol-remote.html`](http://localhost:1999/protocol-remote.html) | Embeds HarmonEasy and drives it: Next note, keyboard, drum pads, controllers, transport, presets and every interface control. Notes HarmonEasy sends back appear under *Sent by Harmoneasy*. |
| Step through a song | [`/presets/protocol/step-song/`](http://localhost:1999/presets/protocol/step-song/) | Any key, the *Next note* pad, a MIDI controller, gamepad 1 or a remote note plays the next note of the song, which is also sent back to connected pages. |
| Remote control playground | [`/presets/protocol/remote-playground/`](http://localhost:1999/presets/protocol/remote-playground/) | A lead synth with Harmoniser and Chordifier controls, plus drums on channel 10, made to be changed remotely. |
| Jam with everything | [`/presets/songs/never-gonna-jam-everything/`](http://localhost:1999/presets/songs/never-gonna-jam-everything/) | A song with every input, including audioBus Protocol, playing along in A♭ major. |

To test: run `pnpm --dir app/harmoneasy run dev`, open the remote control demo, press **Start** inside the embedded app, and wait for the status to turn green. Press **Next note** and you will hear the song step and see the note arrive back. The demo reconnects by itself after preset changes and reloads. The live demo uses `https://designerzen.github.io/harmoneasy/` in place of `http://localhost:1999/`.

The [Cosmo MIDI session links](docs/preset-url-api.md#cosmo-midi-session-links-18-november-2026) collect the Pages URLs for song stepping with audio/MIDI output, quantised notes, chords, bloom and arpeggios.

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
| `pnpm --dir app/harmoneasy exec vitest run tests/protocol-presets.test.ts tests/output-protocol.test.ts tests/input-protocol.test.ts tests/application-commands.test.ts` | Run the audioBus Protocol tests; then try the [demo pages](#remote-control-audiobus-protocol). |
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
| [audiobus](packages/audiobus/README.md) | Musical commands, chains, factories, transformers, instruments, MIDI, effects, formats and storage. |
| [midi-devices](packages/midi-devices/README.md) | Hardware profile JSON, manufacturer metadata, diagrams and registry/API assets. |
| [netronome](packages/netronome/readme.md) | Timing, shared-clock synchronization and worklet support. |
| [control-surface](packages/control-surface/README.md) | Control descriptors, DOM controls and GPU performance surfaces. |
| [Pink Trombone](packages/audiobus-output-pink-trombone/README.md) | Standalone vocal-tract synthesis output. |
| [Voice Workshop](packages/audiobus-output-voice-workshop/README.md) | Physically modelled singing-voice output and worklet. |
| [Vaporisateur](packages/audiobus-output-opendaw-vaporisateur/README.md) | Live openDAW synth instrument and processor asset hosting. |
| [sion](packages/sion/README.md) | SiON engine and Web Audio sessions. |
| [pitfalls](packages/pitfalls/README.md) | Equal-division microtonal scale and pitch mapping. |
| [audiotool](packages/audiotool/README.md) | Nexus connection and recorded-note take export. |
| [opendaw](packages/openDAW/README.md) | Recorded-note export as an openDAW script. |
| [photosynth](packages/photosynth/README.md) | Camera/expression controller and musical-message web component. |
| [flodjs](packages/flodjs/README.md) | Partial tracker playback port; see documented limitations. |
| [midi-ble](packages/midi-ble/README.md) | Incomplete legacy barrel; active BLE adapters are in audiobus. |
| [shared-config](packages/shared-config/README.md) | Shared lint/tooling configuration. |
| `app/harmoneasy/tests/` | App tests; packages also contain their own tests. |

The stack uses TypeScript, Vite, pnpm workspaces, Turbo, Web Audio, SCSS, Vitest and Electron. React is reserved for the graph; surrounding application UI follows the established non-React patterns.

When adding capabilities, update the relevant [input definitions](packages/audiobus/io/input-definitions.ts), [output definitions](packages/audiobus/io/output-definitions.ts), [transformer factory](packages/audiobus/io/transformer-factory.ts), plugin catalogue or hardware profile registry as appropriate. Factories lazy-load devices; their API checks are an initial filter, with connection/runtime requirements checked later.

Read [CODING_STANDARDS.md](CODING_STANDARDS.md) before implementing or reviewing changes. Reuse shared event constants, follow the graph/UI boundary, run checks appropriate to the change, and update this inventory when user-facing capabilities change.

## Credits and support

HarmonEasy builds on Web Audio, Web MIDI, Web Bluetooth, Netronome, Web Audio Modules, WebCLAP, VexFlow, Pink Trombone, Spotify Basic Pitch, Essentia, Magenta, SuperCollider/Supersonic, Audiotool and OpenDAW. The app's About/credits information and plugin catalogue include component attributions; bundled third-party assets retain their own licenses.

Report bugs and request features through [GitHub Issues](https://github.com/designerzen/harmoneasy/issues), join [Discussions](https://github.com/designerzen/harmoneasy/discussions), or [contact the maintainer](mailto:radio@awesomething.co.uk).

## License

HarmonEasy is free software licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a network service, you must offer its users the corresponding source code. Audio analysis uses [Essentia](https://essentia.upf.edu), which is also AGPL-3.0.
