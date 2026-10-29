import type { InputId } from 'audiobus/io/inputs/input-types'
import type { OutputId } from 'audiobus/io/outputs/output-types'
import { elementDescription, elementIcon } from './element-icons'
import { classificationLabel, type ClassifiedChoice } from './device-filters'
import { OUTPUT_DEFINITIONS } from 'audiobus/io/output-definitions'
import { INPUT_DEFINITIONS } from 'audiobus/io/input-definitions'
import { EVENT_ERROR } from 'audiobus/event-constants'
import { MIDI_DEVICE_PROFILES, onMidiDeviceProfilesChanged } from 'audiobus/midi/hardware/device-profiles'

type Guidance = { icon: string; usedFor: string; usefulFor: string; requirements: string }
const guide = (icon: string, usedFor: string, usefulFor: string, requirements: string): Guidance => ({ icon, usedFor, usefulFor, requirements })
const audio = 'Audio enabled in the browser and speakers or headphones.'
const native = 'Desktop runtime with the native MIDI module installed and a connected MIDI device.'
const webmidi = 'A browser with Web MIDI support, MIDI permission, and a connected MIDI device.'
const bluetooth = 'A BLE MIDI device, Bluetooth enabled, and a browser with Web Bluetooth support and device permission.'
const mic = 'A microphone or audio input and microphone permission.'

export const INPUT_GUIDANCE: Record<InputId, Guidance> = {
    ...Object.fromEntries(Object.values(INPUT_DEFINITIONS).map(definition => [definition.id,
        guide('Input', definition.description, `Playing ${definition.name} through a transformation chain.`,
            definition.type === 'midi' ? 'MIDI data or a connected compatible device.' : 'A supported browser and the controls shown by the input.')
    ])),
    'step-sequencer': guide('Seq', 'Edit a repeating sixteen-step note pattern.', 'Writing melodies and drum sequences without a controller.', 'Start the shared transport to play; clear steps for rests.'),
    pads: guide('Pads', 'Play chords or drums from eight large pads.', 'Touchscreen performance and accessible keyboard activation.', 'A pointer, touchscreen, or keyboard; focus a pad and hold Space or Enter.'),
    'microphone-trigger': guide('Mic', 'Turn claps and taps into drum notes.', 'Rhythmic performance from acoustic sounds.', mic + ' Connect the input and set a threshold above room noise.'),
    'camera-gestures': guide('Cam', 'Pinch to play and move your hand to choose pitch.', 'Touch-free playing without specialist hand-tracking hardware.', 'Camera permission, a supported browser, and internet access for the tracking model.'),
    'event-loop': guide('Loop', 'Replay captured musical commands through a chain.', 'Looping notes and controllers with different transformations or sounds.', 'Load JSON from an Event Recorder / Looper output, then restart the transport.'),
    'midi-file': guide('MIDI', 'Play notes from a Standard MIDI File.', 'Transforming or remixing an imported performance.', 'Load a MIDI file, then restart the transport to play.'),
    osc: guide('OSC', 'Receive notes and controllers from an OSC bridge.', 'Playing from external software and custom controllers.', 'A binary OSC WebSocket bridge with matching prefix and message mappings.'),
    ...Object.fromEntries(Object.entries(MIDI_DEVICE_PROFILES).map(([id, profile]) => [id,
        guide('MIDI', profile.description, profile.abilities.join(', '),
            `A connected ${profile.name}, MIDI permission, and Web MIDI or native desktop MIDI support.`)
    ])),
    keyboard: guide('⌨', 'Play notes with computer keys.', 'Trying a chain without a MIDI controller.', 'A physical keyboard and focus on the app.'),
    gamepad: guide('🎮', 'Turn controller buttons and axes into musical input.', 'Playing with a game controller.', 'A connected gamepad and browser Gamepad API support.'),
    'gamepad-music': guide('🎮', 'Play chords, melodies, drums, and arpeggios from a controller.', 'Performing musical patterns with a gamepad.', 'A connected gamepad and browser Gamepad API support.'),
    webmidi: guide('🎹', 'Receive notes and controls from MIDI hardware.', 'Playing a keyboard, pads, or another MIDI controller.', webmidi),
    'native-midi': guide('🎹', 'Receive MIDI through the operating system.', 'Desktop MIDI setups using native device access.', native),
    'midi2-native': guide('🎹', 'Receive MIDI 2.0 notes and per-note controls.', 'Working with expressive MIDI 2.0 equipment.', native + ' MIDI 2.0 features require compatible hardware and drivers.'),
    'ble-midi': guide('📶', 'Receive MIDI wirelessly over Bluetooth.', 'Connecting a wireless keyboard or controller.', bluetooth),
    'microphone-formant': guide('🎤', 'Detect pitch and convert microphone audio into notes.', 'Playing notes with your voice or an acoustic instrument.', mic),
    'leap-motion': guide('✋', 'Map tracked hand positions to notes and velocity.', 'Touch-free gesture performance.', 'A Leap Motion controller and its tracking software/library.'),
    'onscreen-keyboard': guide('🎹', 'Play notes on an onscreen piano.', 'Touchscreen playing and quick note checks.', 'A mouse, touchpad, or touchscreen.'),
    'prompt-ai': guide('✦', 'Generate note sequences from written prompts.', 'Sketching musical ideas from text.', 'An internet connection and an API key configured for the generator.'),
    'prompt-ai-speech': guide('🎙', 'Speak prompts to generate note sequences.', 'Hands-free musical idea generation.', 'Microphone permission, browser speech recognition, internet access, and a configured generator API key.'),
    'midi-transport-clock': guide('⏱', 'Receive MIDI clock and transport commands.', 'Synchronizing timing with an external MIDI source.', 'A connected MIDI clock source and MIDI access.'),
    'music-mouse': guide('↔', 'Use pointer movement to generate musical notes.', 'Exploring melodies and harmonies by movement.', 'A mouse, touchpad, or compatible pointer.'),
    'microphone-pitch': guide('🎤', 'Detect played or sung pitches from microphone audio.', 'Turning an acoustic instrument or voice into note input.', mic + ' The pitch-detection model must load.'),
    'dvs-control-vinyl': guide('◉', 'Estimate relative playback speed from a control-vinyl tone.', 'Driving timing from a turntable; not absolute position or direction.', 'Control vinyl, a turntable connected to an audio input, and microphone permission.'),
}

onMidiDeviceProfilesChanged(() => {
    for (const [id, profile] of Object.entries(MIDI_DEVICE_PROFILES)) INPUT_GUIDANCE[id] = guide('MIDI', profile.description,
        profile.abilities.join(', ') || `Playing ${profile.name}.`, `A connected ${profile.name} and MIDI access.`)
})

export const OUTPUT_GUIDANCE: Record<OutputId, Guidance> = {
    performance: guide('Perf', 'Record IOChain load and app responsiveness.', 'Compare event rate, processing delay, FPS and Netronome timing; red graph markers identify lag.', 'A visible browser tab. Run the transport for timing metrics. Main-thread blocking requires Long Tasks API support.'),
    ...Object.fromEntries(Object.values(OUTPUT_DEFINITIONS).map(definition => [definition.id,
        guide('Plugin', definition.description,
            definition.type === 'engine' ? `Playing ${definition.name} from incoming MIDI notes.`
                : definition.type === 'visual' ? 'Inspecting the audio mix.' : 'Shaping the audio mix with a plugin.',
            definition.id.startsWith('webclap:') ? audio + ' WebAssembly and AudioWorklet support. Native interfaces require HTTPS or localhost.'
                : audio + ' The plugin engine and any samples must be available.')
    ])),
    'drum-accompaniment': guide('Dr', 'Add a steady drum break alongside your instrument.', 'Choose a groove and tuning note, then start the global transport. Busy playing adds subtle variations.', audio),
    'note-monitor': guide('Notes', 'Display transformed pitches, channels and durations.', 'Checking harmony, routing and held notes.', 'Musical notes from an input or transformer.'),
    'sample-player': guide('Sample', 'Play your own audio sample across MIDI notes.', 'Custom instruments, found sounds and pitched samples.', audio + ' Load an audio file up to 4 MB; set its original MIDI pitch.'),
    'event-recorder': guide('Loop', 'Capture this chain’s musical commands as a replayable loop.', 'Reusing a performance with different transformations or instruments.', 'Record notes, download the event-loop JSON and load it in an Event Loop input.'),
    osc: guide('OSC', 'Send notes and controllers to an OSC bridge.', 'Controlling external musical or multimedia software.', 'A binary OSC WebSocket bridge with matching prefix and message mappings.'),
    recorder: guide('Rec', 'Record the master audio and download WAV.', 'Saving a rendered performance.', audio + ' All Recorder outputs share the same recording session.'),
    moog: guide('M', 'Play the Photosynth Moog ladder synthesizer.', 'Shaping basses, leads and chords with cutoff, resonance and envelopes.', audio + ' Internet access to load the WAM SDK.'),
    tb303: guide('303', 'Play a monophonic TB-303 bass synthesizer.', 'Acid bass with live filter controls. Overlap notes for slide; velocity 100–127 adds accent.', audio + ' AudioWorklet support and internet access to load the WAM SDK.'),
    describe: guide('Aa', 'Describe active notes and chords in musical language.', 'Identifying extended chords, added tones, and inversions while playing.', 'Notes from a connected input or transformer.'),
    console: guide('⌘', 'Log outgoing note events.', 'Debugging a chain and checking its output.', 'Development mode and the browser developer console.'),
    'pink-trombone': guide('🗣', 'Create vocal-like synthesized sound.', 'Exploring speech-like tones and unusual instruments.', audio),
    notation: guide('♫', 'Show notes on a musical staff.', 'Reading and checking the notes a chain produces.', 'Incoming note events. Does not produce sound by itself.'),
    'spectrum-analyser': guide('▥', 'Display the audio spectrum and waveform.', 'Inspecting the sound of the audio mix.', 'An active audio mixer with sound flowing through it.'),
    'speech-synthesis': guide('🗣', 'Speak or sing note names using browser voices.', 'Audible note identification and experimentation.', 'Browser speech synthesis, an installed voice, and audio output.'),
    vibrator: guide('▤', 'Trigger vibration for notes within a range.', 'Tactile feedback on compatible devices.', 'Vibration-capable hardware and browser Vibration API support.'),
    webmidi: guide('🎹', 'Send note events to an external MIDI destination.', 'Playing a hardware synth or routing to another music app.', webmidi),
    'native-midi': guide('🎹', 'Send MIDI through the operating system.', 'Desktop routing to MIDI instruments and ports.', native),
    'ble-midi': guide('📶', 'Send MIDI wirelessly over Bluetooth.', 'Playing a compatible wireless MIDI instrument.', bluetooth),
    midi2: guide('🎹', 'Send MIDI 2.0 messages to a device.', 'Using compatible MIDI 2.0 destinations.', native + ' A compatible MIDI 2.0 destination is required.'),
    'midi2-native': guide('🎹', 'Send MIDI 2.0 notes and per-note controls natively.', 'Controlling expressive MIDI 2.0 instruments.', native + ' MIDI 2.0 features require compatible hardware and drivers.'),
    supersonic: guide('∿', 'Generate sound with a SuperCollider-based engine.', 'Synthesized instrument playback in the app.', audio + ' The Supersonic engine assets must load.'),
    wam2: guide('▣', 'Host Web Audio Module instruments.', 'Playing a compatible browser audio plugin.', audio + ' A compatible WAM plugin must be loaded.'),
    wam: guide('Plugin', 'Host legacy Web Audio Module instruments.', 'Playing Yoshimi or webDX7 from incoming MIDI notes.', audio + ' The selected WAM engine and its assets must load.'),
    yoshimi: guide('∿', 'Play a software synthesizer with instrument presets.', 'Exploring a broad range of synthesized sounds.', audio + ' The Yoshimi engine and preset assets must load.'),
    metronome: guide('⏱', 'Turn MIDI clock signals into audible clicks.', 'Hearing the timing pulse.', audio + ' MIDI clock events must reach this output.'),
    'audio-click': guide('⏱', 'Play selected click samples on bar events.', 'An audible bar reference using sample sounds.', audio + ' A click sample library and timing events.'),
    butterchurn: guide('✺', 'Visualize the audio mix with animated patterns.', 'Live visuals that react to sound.', 'WebGL support and an active audio mix.'),
}

export function fillDeviceCard(button: HTMLButtonElement, factory: Pick<ClassifiedChoice, 'id' | 'name' | 'description'> & Partial<ClassifiedChoice>, direction: 'input' | 'output' | 'instrument') {
    const guidance = (direction === 'input' ? INPUT_GUIDANCE[factory.id as InputId]
        : direction === 'output' ? OUTPUT_GUIDANCE[factory.id as OutputId] : undefined)
        ?? (factory.id.startsWith('webclap:')
            ? guide('', factory.description, factory.type === 'engine' ? 'Playing MIDI notes through a browser instrument.' : factory.type === 'visual' ? 'Inspecting the audio mix.' : 'Shaping the audio mix with a plugin.', audio + ' WebAssembly and AudioWorklet support. Native interfaces require HTTPS or localhost.')
        : direction !== 'instrument'
            ? guide('', factory.description, `Using ${factory.name} in a chain.`, 'A compatible device and any required browser permissions.')
        : guide('♫', 'Turn incoming notes into instrument audio.', `Playing ${factory.name} in a chain${factory.category ? ` (${factory.category})` : ''}.`, audio + ' Any instrument samples or engine assets must be available.')
        )
    const append = (className: string, text: string) => {
        const span = document.createElement('span')
        span.className = className
        span.textContent = text
        button.appendChild(span)
        return span
    }
    button.replaceChildren()
    button.classList.add('device-choice-card')
    button.title = factory.title ? `${factory.title}: ${factory.description}` : elementDescription(direction, factory.id, factory.name, factory.description)
    const icon = document.createElement('span')
    icon.className = 'item-icon element-icon'
    icon.style.maskImage = `url("${elementIcon(direction, factory.id)}")`
    icon.setAttribute('aria-hidden', 'true')
    icon.title = button.title
    button.appendChild(icon)
    const preview = factory.preview ?? (direction === 'output' ? OUTPUT_DEFINITIONS[factory.id]?.preview : undefined)
    if (preview) {
        const image = document.createElement('img')
        image.className = 'device-choice-preview'
        image.src = `${import.meta.env.BASE_URL}${preview.replace(/^\//, '')}`
        image.alt = `${factory.name} controls`
        image.loading = 'lazy'
        icon.hidden = true
        image.addEventListener(EVENT_ERROR, () => { image.remove(); icon.hidden = false }, { once: true })
        button.appendChild(image)
    }
    append('item-name', factory.name)
    if (factory.type && factory.subtype) append('item-classification', `${classificationLabel(factory.type)} / ${classificationLabel(factory.subtype)}${factory.category ? ` / ${classificationLabel(factory.category)}` : ''}`)
    append('item-description', factory.description)
    if (factory.attribution) append('item-attribution', `By ${factory.attribution.author} · ${factory.attribution.license}. Attribution and license links are in the plugin controls.`)
    for (const [label, value] of [['Used for', guidance.usedFor], ['Useful for', guidance.usefulFor], ['Requirements', guidance.requirements]]) {
        if (label === 'Used for' && value.trim() === factory.description.trim()) continue
        const row = document.createElement('span')
        row.className = 'device-choice-detail'
        const heading = document.createElement('span')
        heading.className = 'device-choice-label'
        heading.textContent = label
        const text = document.createElement('span')
        text.textContent = value
        row.append(heading, text)
        button.appendChild(row)
    }
    button.dataset.search = [factory.name, factory.title, factory.description, factory.type, factory.subtype, factory.category, factory.attribution?.author, factory.attribution?.license, guidance.usedFor, guidance.usefulFor, guidance.requirements].join(' ').toLowerCase()
}
