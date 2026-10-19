import { DEFAULT_PRESET_LIBRARY } from 'audiobus/io/transformer-presets'
import type { PresetSetup } from 'audiobus/io/preset-library'

interface StartContext {
    id: string
    name: string
    category: string
    description: string
    next: string
    presets: string[]
}

export const START_CONTEXTS: StartContext[] = [
    { id: 'classroom', name: 'Synchronise a classroom', category: 'Together',
        description: 'Help a classroom improvise together: everyone plays in C major and can share a clock.',
        next: 'After starting, use Sync to connect browsers to a shared clock, then connect each learner’s controller.', presets: ['c-major-sketchbook'] },
    { id: 'convert', name: 'Convert a format', category: 'Files',
        description: 'Move a piece between music programs without changing its notes or rhythm.',
        next: 'After starting, import MIDI, MusicXML, DawProject or a tracker file. Play it through the chain to capture its notes, then choose a format in Export.', presets: [] },
    { id: 'remix', name: 'Remix an existing piece', category: 'Files',
        description: 'Turn the notes in an existing piece into moving C major chord patterns.',
        next: 'After starting, import your piece, play the chain and capture a take to export.', presets: ['chord-arpeggiator'] },
    { id: 'live', name: 'Harmonize live', category: 'Live playing',
        description: 'Play one note and hear a whole chord. Your notes fit C major as you play.',
        next: 'Connect a MIDI input or use the onscreen keyboard. Change the key and scale in the chain.', presets: ['classic-chord'] },
    { id: 'jam', name: 'Jam with friends', category: 'Together',
        description: 'Improvise with friends in D Dorian, a minor sound with a brighter sixth.',
        next: 'Use Sync after starting to share timing with the other players.', presets: ['d-dorian-session'] },
    { id: 'songwriting', name: 'Sketch a chord progression', category: 'Writing',
        description: 'Write a richer accompaniment with four-note chords, using just one finger.',
        next: 'Play a progression, record a take and export it to your music software.', presets: ['seventh-heaven'] },
    { id: 'bass', name: 'Build a bass line', category: 'Writing',
        description: 'Turn a few notes into a short, low A minor bass part.',
        next: 'Play notes on your keyboard and adjust the tempo to suit the groove.', presets: ['low-minor-pulse'] },
    { id: 'arpeggios', name: 'Explore arpeggios', category: 'Live playing',
        description: 'Hear a single note unfold into a crisp ascending chord pattern.',
        next: 'Hold notes to explore patterns and adjust the chain’s arpeggiator settings.', presets: ['staccato-arp'] },
    { id: 'practice', name: 'Practise in a minor key', category: 'Learning',
        description: 'Explore a reflective melody while your notes stay in A minor.',
        next: 'Use a keyboard to play; inspect the chain to change the scale as you learn.', presets: ['a-minor-nocturne'] },
    { id: 'blank', name: 'Start a fresh chain', category: 'Custom',
        description: 'Prepare an untransformed keyboard and synth chain for your own setup.',
        next: 'Add inputs, transformers and outputs in the graph after starting.', presets: [] },
    { id: 'first-notes', name: 'Make music without knowing scales', category: 'Learning',
        description: 'Try any notes on the onscreen keyboard and hear them fit C major. No MIDI hardware needed.',
        next: 'Click a few onscreen keys. Compare the notes you play with the notes you hear and see.', presets: ['c-major-sketchbook'] },
    { id: 'one-finger', name: 'Play chords with one finger', category: 'Learning',
        description: 'Turn a simple tune into full C major chords, even on a small keyboard.',
        next: 'Press one onscreen key at a time. Each note becomes a chord; try a few different roots.', presets: ['classic-chord'] },
    { id: 'major-minor', name: 'Hear what makes minor sound different', category: 'Learning',
        description: 'Explore A minor chords and compare their mood with the major chord starting points.',
        next: 'Play a short sequence of single notes. Listen to the minor chords each note creates.', presets: ['minor-chord-diary'] },
    { id: 'hear-sevenths', name: 'Discover richer chord colours', category: 'Learning',
        description: 'Hear how adding a fourth note changes a simple chord into a seventh chord.',
        next: 'Play slow single notes and inspect the four pitches in each chord in the chain.', presets: ['seventh-heaven'] },
    { id: 'hear-triplets', name: 'Understand triplets by hearing them', category: 'Learning',
        description: 'Turn a root note into a rolling three-part chord figure against a steady beat.',
        next: 'Enable the metronome, play a note and listen to the triplet spacing. Try a slower tempo.', presets: ['triplet-cascade'] },
    { id: 'call-response', name: 'Run a classroom call and response', category: 'Together',
        description: 'Give learners a shared C major palette for copying and answering a short phrase.',
        next: 'Use Sync for a shared clock. Have one learner play a phrase, then let the next learner answer.', presets: ['c-major-sketchbook'] },
    { id: 'group-chords', name: 'Let beginners accompany a group', category: 'Together',
        description: 'Give a new player one-finger major chords to support a group melody.',
        next: 'Agree on C major with the other players. Use Sync for timing and play chord roots on the beat.', presets: ['classic-chord'] },
    { id: 'group-bass', name: 'Take the bass role in a jam', category: 'Together',
        description: 'Move a C major part down an octave so it can sit below the other players.',
        next: 'Agree on the key, use Sync for timing and play a few low supporting notes.', presets: ['bass-register'] },
    { id: 'gamepad-music', name: 'Make a game controller musical', category: 'Controllers',
        description: 'Keep controller notes in C major so button presses can become a melody.',
        next: 'Add a gamepad input to the chain, press a controller button to connect, then try its note controls.', presets: ['c-major-sketchbook'] },
    { id: 'midi-chords', name: 'Get more from a small MIDI keyboard', category: 'Controllers',
        description: 'Make a compact controller play full chords without needing to reach every chord tone.',
        next: 'Add a WebMIDI input, select your controller and play one note at a time.', presets: ['classic-chord'] },
    { id: 'midi-fifths', name: 'Shift a controller part up a fifth', category: 'Controllers',
        description: 'Hear each incoming note seven semitones higher, useful for trying a part in another register.',
        next: 'Connect a MIDI input and play a familiar phrase. The chain transposes it up a perfect fifth.', presets: ['fifth-above'] },
    { id: 'minor-song', name: 'Write a moody accompaniment', category: 'Writing',
        description: 'Build A minor chords from single root notes for a reflective verse or chorus.',
        next: 'Try a slow sequence of roots and listen for a progression you want to keep.', presets: ['minor-chord-diary'] },
    { id: 'melody-hook', name: 'Find a short melodic hook', category: 'Writing',
        description: 'Keep a busy idea concise with short notes that stay in C major.',
        next: 'Repeat a small phrase, leave gaps and change one note each time. Export a take you like.', presets: ['minimal-motion'] },
    { id: 'rolling-accompaniment', name: 'Give a sparse song some movement', category: 'Writing',
        description: 'Turn a few root notes into C major chord patterns that rise and fall across two octaves.',
        next: 'Play the roots of a progression slowly and let each wide arpeggio unfold.', presets: ['two-octave-pendulum'] },
    { id: 'answer-vocal', name: 'Write an answering phrase for a vocal', category: 'Writing',
        description: 'Create descending A minor figures that can fill the gaps between sung lines.',
        next: 'Play a root note in a gap in your vocal idea and listen to the descending chord tones.', presets: ['falling-minor-arp'] },
    { id: 'sparkle-hook', name: 'Write a high plucked hook', category: 'Writing',
        description: 'Move a C major melody up an octave and shorten its notes for a light, high part.',
        next: 'Play a simple motif in the middle of the keyboard. The chain raises and shortens it.', presets: ['upper-octave-sparkle'] },
    { id: 'offbeat', name: 'Make offbeat chord stabs', category: 'Rhythm',
        description: 'Play on the beat and hear short major chords land an eighth note later.',
        next: 'Enable the metronome and play steady root notes on the beat. Listen for the offbeat response.', presets: ['offbeat-chord-stabs'] },
    { id: 'chord-pulse', name: 'Turn a note into a chord pulse', category: 'Rhythm',
        description: 'Make one root note trigger four evenly spaced C major chord strikes.',
        next: 'Start at 120 BPM: the 250 ms repeats fit eighth notes. Play one note and leave room for its repeats.', presets: ['chord-repeater'] },
    { id: 'double-hit', name: 'Give each note a double hit', category: 'Rhythm',
        description: 'Turn every note into two short strikes for a bouncing rhythmic part.',
        next: 'Try 120 BPM, where the 125 ms gap fits sixteenth notes. Play a sparse pattern.', presets: ['double-tap'] },
    { id: 'rapid-fill', name: 'Trigger a rapid transition fill', category: 'Rhythm',
        description: 'Turn one note into eight quick strikes for a roll before the next section.',
        next: 'At 120 BPM the 62.5 ms repeats fit thirty-second notes. Trigger a note just before a change.', presets: ['ratchet-fill'] },
    { id: 'delayed-phrase', name: 'Play a phrase behind the beat', category: 'Rhythm',
        description: 'Shift your whole phrase a quarter note later to hear a delayed response.',
        next: 'Enable the metronome and play a short phrase. This chain delays the phrase; add a separate direct chain if you also want the original.', presets: ['late-answer'] },
    { id: 'triplet-song', name: 'Try a rolling triplet accompaniment', category: 'Rhythm',
        description: 'Turn a chord root into ascending triplets to change the feel of a progression.',
        next: 'Play your progression’s roots against the metronome and adjust the tempo until the roll feels right.', presets: ['triplet-cascade'] },
    { id: 'shuffle-ideas', name: 'Discover unexpected chord melodies', category: 'Experimenting',
        description: 'Randomly reorder C major chord tones to find variations that stay in harmony.',
        next: 'Play the same root several times and listen for a different order of notes. Keep a phrase you like.', presets: ['shuffled-chord-tones'] },
    { id: 'wide-pattern', name: 'Stretch a tiny idea across two octaves', category: 'Experimenting',
        description: 'Hear one root note become a wide rising and falling major chord figure.',
        next: 'Play isolated roots and leave enough time to hear the full contour of each pattern.', presets: ['two-octave-pendulum'] },
    { id: 'dorian-colour', name: 'Escape the usual major or minor sound', category: 'Experimenting',
        description: 'Try D Dorian: a minor palette with a raised sixth for a different melodic colour.',
        next: 'Improvise over a D minor idea and listen for the B natural that gives Dorian its character.', presets: ['d-dorian-session'] },
    { id: 'midi-to-score', name: 'Turn a MIDI idea into notation', category: 'Files',
        description: 'Import a MIDI performance and export MusicXML for a notation program, or view its musical score.',
        next: 'Import a MIDI file and play it through the chain to capture its notes, then choose MusicXML or Download Sheet Music in Export.', presets: [] },
    { id: 'score-to-midi', name: 'Bring a written score into a sequencer', category: 'Files',
        description: 'Use a MusicXML score as note material that you can export as MIDI.',
        next: 'Import the MusicXML file and play it through the chain to capture its notes, then export MIDI and open it in your sequencer.', presets: [] },
    { id: 'tracker-to-midi', name: 'Reuse notes from a tracker tune', category: 'Files',
        description: 'Bring note material from a MOD, XM, IT or S3M file into a MIDI workflow.',
        next: 'Import a tracker file and play it through the chain to capture its notes, then export MIDI. Tracker samples and effects are not recreated by this note conversion.', presets: [] },
    { id: 'daw-handoff', name: 'Take a sketch into a music workstation', category: 'Files',
        description: 'Play a major-key idea here, then use the export tools to continue arranging elsewhere.',
        next: 'Play a short take, then use Export for MIDI, DawProject, AudioTool or OpenDAW.', presets: ['c-major-sketchbook'] },
    { id: 'remix-minor', name: 'Reimagine a melody in a minor key', category: 'Remixing',
        description: 'Move imported notes into A minor to explore a different mood.',
        next: 'Import a piece, play it through the A minor chain and compare the result before exporting.', presets: ['a-minor-nocturne'] },
    { id: 'remix-bass', name: 'Turn an imported melody into bass material', category: 'Remixing',
        description: 'Fit a melody to C major and move it down an octave as a starting point for a bass part.',
        next: 'Import a melody, play it through the chain and choose a bass sound if you want a deeper timbre.', presets: ['bass-register'] },
    { id: 'remix-plucks', name: 'Make a busy imported part shorter and lighter', category: 'Remixing',
        description: 'Constrain notes to C major and shorten their gates to leave more space.',
        next: 'Import your piece and play it through the chain. Listen for shorter notes; overlapping pitches may still form chords.', presets: ['minimal-motion'] },
    { id: 'remix-fifths', name: 'Transpose an existing part by a fifth', category: 'Remixing',
        description: 'Move imported notes up seven semitones while keeping their relative intervals.',
        next: 'Import a file, play the chain and export the shifted performance for your arrangement.', presets: ['fifth-above'] },
    { id: 'minor-arpeggio', name: 'Make a gentle descending accompaniment', category: 'Live playing',
        description: 'Turn a single root note into slower, falling A minor chord tones.',
        next: 'Play roots slowly and leave space for the descending eighth-note figures.', presets: ['falling-minor-arp'] },
    { id: 'clean-lead', name: 'Keep a live lead simple and in key', category: 'Live playing',
        description: 'Make your playing short and clear while fitting it to C major.',
        next: 'Use your keyboard or connect a MIDI input. Play short phrases and adjust the chain’s note duration.', presets: ['minimal-motion'] },
    { id: 'high-live', name: 'Move a live melody above the accompaniment', category: 'Live playing',
        description: 'Raise C major notes an octave and shorten them so they sit in a higher register.',
        next: 'Play a midrange phrase and listen to the higher result. Connect your controller for live use.', presets: ['upper-octave-sparkle'] }
]

export const START_SUGGESTIONS = [
    { name: 'I’m new to making music', contexts: ['first-notes', 'one-finger', 'practice', 'major-minor', 'hear-triplets'] },
    { name: 'I’m teaching or playing with others', contexts: ['classroom', 'call-response', 'group-chords', 'group-bass', 'jam'] },
    { name: 'I need a song idea', contexts: ['songwriting', 'minor-song', 'melody-hook', 'rolling-accompaniment', 'answer-vocal', 'sparkle-hook', 'bass'] },
    { name: 'I have a file to work with', contexts: ['convert', 'midi-to-score', 'score-to-midi', 'tracker-to-midi', 'remix', 'remix-minor', 'remix-bass', 'remix-plucks', 'remix-fifths', 'daw-handoff'] },
    { name: 'I want to perform live', contexts: ['live', 'midi-chords', 'midi-fifths', 'gamepad-music', 'clean-lead', 'high-live', 'arpeggios', 'minor-arpeggio'] },
    { name: 'Surprise me with a new pattern', contexts: ['shuffle-ideas', 'wide-pattern', 'dorian-colour', 'offbeat', 'chord-pulse', 'double-hit', 'rapid-fill', 'delayed-phrase', 'triplet-song'] }
]

export function createContextSetup(context: StartContext): PresetSetup {
    const steps = context.presets.flatMap(id => {
        const preset = DEFAULT_PRESET_LIBRARY.presets.find(preset => preset.id === id)
        if (!preset) throw new Error(`Unknown context preset: ${id}`)
        return structuredClone(preset.steps)
    })
    return {
        id: context.id, name: context.name, description: context.description, activeChainId: 'context-chain',
        devices: [
            { id: 'computer-keyboard', direction: 'input', definition: { factory: 'input', type: 'keyboard' } },
            { id: 'keyboard', direction: 'input', definition: { factory: 'keyboard-input' } },
            { id: 'keyboard-display', direction: 'output', definition: { factory: 'keyboard-output', inputId: 'keyboard' } },
            { id: 'synth', direction: 'output', definition: { factory: 'polyphonic' } },
            { id: 'ui', direction: 'output', definition: { factory: 'external', type: 'ui' } }
        ],
        chains: [{ id: 'context-chain', options: { name: context.name, active: true }, steps,
            inputs: ['computer-keyboard', 'keyboard'], outputs: ['keyboard-display', 'synth', 'ui'] }]
    }
}

export function createStartContexts(root: HTMLElement) {
    const list = root.querySelector<HTMLFieldSetElement>('#start-context-list')!
    const search = root.querySelector<HTMLInputElement>('#start-context-filter')!
    const category = root.querySelector<HTMLSelectElement>('#start-context-category')!
    const selection = root.querySelector<HTMLElement>('#start-context-selection')!
    const suggestions = root.querySelector<HTMLElement>('#start-context-suggestions')!
    let selected: StartContext | undefined
    let suggestion: typeof START_SUGGESTIONS[number] | undefined = START_SUGGESTIONS[0]
    for (const name of new Set(START_CONTEXTS.map(context => context.category))) {
        const option = document.createElement('option')
        option.textContent = name
        option.value = name
        category.add(option)
    }
    const current = document.createElement('label')
    const radio = document.createElement('input')
    radio.type = 'radio'; radio.name = 'start-context'; radio.value = ''; radio.checked = true
    current.append(radio, 'Current session')
    list.append(current)
    const entries = START_CONTEXTS.map(context => {
        const entry = document.createElement('label')
        const input = document.createElement('input')
        input.type = 'radio'; input.name = 'start-context'; input.value = context.id
        const title = document.createElement('strong')
        title.textContent = context.name
        const description = document.createElement('span')
        description.textContent = context.description
        const preview = document.createElement('small')
        preview.className = 'start-context-chain'
        preview.textContent = `Your chain: Keyboard or imported notes → ${context.presets.map(id => DEFAULT_PRESET_LIBRARY.presets.find(preset => preset.id === id)!.name).join(' → ') || 'Notes unchanged'} → Synth`
        entry.append(input, title, description, preview)
        list.append(entry)
        return { context, entry }
    })
    list.addEventListener('change', () => {
        selected = START_CONTEXTS.find(context => context.id === list.querySelector<HTMLInputElement>('input:checked')?.value)
        selection.textContent = selected ? `${selected.name}. ${selected.next}` : 'Current session: restore your saved chains or start with the default setup.'
    })
    const filter = () => {
        const words = search.value.trim().toLowerCase().split(/\s+/)
        let count = 0
        for (const { context, entry } of entries) {
            const text = `${context.name} ${context.category} ${context.description} ${context.next}`.toLowerCase()
            entry.hidden = Boolean(suggestion && !suggestion.contexts.includes(context.id)) || Boolean(category.value && category.value !== context.category) || !words.every(word => text.includes(word))
            if (!entry.hidden) count++
        }
        root.querySelector('#start-context-count')!.textContent = count ? `${count} starting points${suggestion ? ` for “${suggestion.name}”` : ' available'}` : 'No matching contexts. Try another search or activity.'
    }
    const suggestionButtons: HTMLButtonElement[] = []
    const updateSuggestions = () => suggestionButtons.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(index > 0 ? suggestion === START_SUGGESTIONS[index - 1] : !suggestion))
    })
    for (const item of [undefined, ...START_SUGGESTIONS]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = item?.name ?? `Explore all ${START_CONTEXTS.length} starting points`
        button.setAttribute('aria-controls', list.id)
        button.addEventListener('click', () => {
            suggestion = item
            search.value = ''
            category.value = ''
            updateSuggestions()
            filter()
        })
        suggestionButtons.push(button)
        suggestions.append(button)
    }
    const manualFilter = () => {
        suggestion = undefined
        updateSuggestions()
        filter()
    }
    search.addEventListener('input', manualFilter)
    category.addEventListener('change', manualFilter)
    updateSuggestions()
    filter()
    return { getSetup: () => selected ? createContextSetup(selected) : undefined }
}
