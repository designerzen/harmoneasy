import type { InputId } from 'audiobus/io/inputs/input-types'
import type { OutputId } from 'audiobus/io/outputs/output-types'

type Guidance = { icon: string; usedFor: string; usefulFor: string; requirements: string }
const guide = (icon: string, usedFor: string, usefulFor: string, requirements: string): Guidance => ({ icon, usedFor, usefulFor, requirements })
const audio = 'Audio enabled in the browser and speakers or headphones.'
const native = 'Desktop runtime with the native MIDI module installed and a connected MIDI device.'
const webmidi = 'A browser with Web MIDI support, MIDI permission, and a connected MIDI device.'
const bluetooth = 'A BLE MIDI device, Bluetooth enabled, and a browser with Web Bluetooth support and device permission.'
const mic = 'A microphone or audio input and microphone permission.'

export const INPUT_GUIDANCE: Record<InputId, Guidance> = {
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

export const OUTPUT_GUIDANCE: Record<OutputId, Guidance> = {
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
    yoshimi: guide('∿', 'Play a software synthesizer with instrument presets.', 'Exploring a broad range of synthesized sounds.', audio + ' The Yoshimi engine and preset assets must load.'),
    metronome: guide('⏱', 'Turn MIDI clock signals into audible clicks.', 'Hearing the timing pulse.', audio + ' MIDI clock events must reach this output.'),
    'audio-click': guide('⏱', 'Play selected click samples on bar events.', 'An audible bar reference using sample sounds.', audio + ' A click sample library and timing events.'),
    butterchurn: guide('✺', 'Visualize the audio mix with animated patterns.', 'Live visuals that react to sound.', 'WebGL support and an active audio mix.'),
}

export function fillDeviceCard(button: HTMLButtonElement, factory: { id: string; name: string; description: string; category?: string }, direction: 'input' | 'output' | 'instrument') {
    const guidance = direction === 'input' ? INPUT_GUIDANCE[factory.id as InputId]
        : direction === 'output' ? OUTPUT_GUIDANCE[factory.id as OutputId]
        : guide('♫', 'Turn incoming notes into instrument audio.', `Playing ${factory.name} in a chain${factory.category ? ` (${factory.category})` : ''}.`, audio + ' Any instrument samples or engine assets must be available.')
    const append = (className: string, text: string) => {
        const span = document.createElement('span')
        span.className = className
        span.textContent = text
        button.appendChild(span)
        return span
    }
    button.replaceChildren()
    button.classList.add('device-choice-card')
    append('item-icon', guidance.icon).setAttribute('aria-hidden', 'true')
    append('item-name', factory.name)
    append('item-description', factory.description)
    for (const [label, value] of [['Used for', guidance.usedFor], ['Useful for', guidance.usefulFor], ['Requirements', guidance.requirements]]) {
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
    button.dataset.search = [factory.name, factory.description, guidance.usedFor, guidance.usefulFor, guidance.requirements].join(' ').toLowerCase()
}
