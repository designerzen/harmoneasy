import type { AudioCommandInterface } from "../audio-command-interface"
import { Transformer } from "./abstract-transformer"
import AudioCommand from "../audio-command"
import * as Commands from "../../../commands"
import type Timer from "../timing/timer"
import type { TransformerInterface } from "./interface-transformer"

export const ID_ARPEGGIATOR = "Arpeggiator"

type ArpPattern = 'up' | 'down' | 'up-down' | 'down-up' | 'random' | 'chord'

interface Config {
    pattern: ArpPattern
    rate: string // Note division: '1/4', '1/8', '1/16', '1/32', or 'triplet'
    octaves: number // how many octaves to span (1-4)
}

const DEFAULT_OPTIONS: Config = {
    pattern: 'up',
    rate: '1/16', // 16th notes
    octaves: 1
}

/**
 * Fisher-Yates shuffle for randomising array entries
 */
const shuffleArray = <T>(array: T[]): T[] => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

/**
 * Arpeggiator Transformer
 *
 * Takes incoming note commands and generates arpeggiated patterns.
 * When multiple notes are held down, creates an arpeggio sequence.
 *
 * Patterns:
 * - up: Notes ascending
 * - down: Notes descending
 * - up-down: Ascend then descend
 * - down-up: Descend then ascend
 * - random: Random order
 * - chord: All notes at once (passthrough)
 */
export class TransformerArpeggiator extends Transformer<Config> implements TransformerInterface {

    id = ID_ARPEGGIATOR

    // Track currently held notes to build the arpeggio sequence
    private heldNotes: Set<number> = new Set()

    // Track the last arpeggio index for continuous patterns
    private currentArpIndex: number = 0

    // Track when notes were pressed to handle timing
    private noteOnTimes: Map<number, number> = new Map()

    // Track which arpeggiated notes were generated for each original note
    // Map: original note number -> Array of {noteNumber, startAt} for each arpeggiated note
    private arpeggiatedNotesMap: Map<number, Array<{noteNumber: number, startAt: number}>> = new Map()

    // Time window (in seconds) to consider notes as part of the same chord
    private readonly CHORD_DETECT_WINDOW = 0.05 // 50ms

    // Track if we're currently building a chord
    private pendingChordNotes: Map<number, AudioCommandInterface> = new Map()
    private chordTimer: number | null = null

    // Track the last time a chord was processed
    private lastChordTime: number = 0

    get name(): string {
        return 'Arpeggiator'
    }

    get fields() {
        return [
            {
                name: 'enabled',
                type: 'select',
                values: [
                    { name: 'On', value: 1 },
                    { name: 'Off', value: 0 }
                ]
            },
            {
                name: 'pattern',
                type: 'select',
                values: [
                    { name: 'Up', value: 'up' },
                    { name: 'Down', value: 'down' },
                    { name: 'Up-Down', value: 'up-down' },
                    { name: 'Down-Up', value: 'down-up' },
                    { name: 'Random', value: 'random' },
                    { name: 'Chord', value: 'chord' }
                ]
            },
            {
                name: 'rate',
                type: 'select',
                values: [
                    { name: '1/4', value: '1/4' },
                    { name: '1/8', value: '1/8' },
                    { name: '1/16', value: '1/16' },
                    { name: '1/32', value: '1/32' },
                    { name: 'Triplet', value: 'triplet' }
                ]
            },
            {
                name: 'octaves',
                type: 'select',
                values: [1, 2, 3, 4]
            }
        ]
    }

    get description():string{
        return "Arpeggiate incoming notes based on the selected pattern and rate."
    }

    constructor(config: Partial<Config> = {}) {
        super({ ...DEFAULT_OPTIONS, ...config })
    }

    /**
     * Calculate delay in milliseconds based on note division and BPM
     */
    private calculateDelayMs(rate: string, bpm: number): number {
        const beatDurationMs = (60 / bpm) * 1000 // Duration of one quarter note in ms
        switch (rate) {
            case '1/4':
                return beatDurationMs
            case '1/8':
                return beatDurationMs / 2
            case '1/16':
                return beatDurationMs / 4
            case '1/32':
                return beatDurationMs / 8
            case 'triplet':
                return beatDurationMs / 3
            default:
                return beatDurationMs / 4 // Default to 16th notes
        }
    }

    transform(commands: AudioCommandInterface[], timer: Timer): AudioCommandInterface[] {

        if (!this.config.enabled || commands.length === 0) {
            //console.log('[ARPEGGIATOR] Bypassing - disabled or no commands')
            return commands
        }
      
        const bpm = timer.BPM

        console.log('[ARPEGGIATOR] Transform called', {
            enabled: this.config.enabled,
            commandCount: commands.length,
            config: this.config,
            bpm
        })

        const arpeggiated: AudioCommandInterface[] = []

        // Group note-on commands that occur at the same time (chord detection)
        const noteOnCommands: AudioCommandInterface[] = []
        const otherCommands: AudioCommandInterface[] = []

        for (const command of commands) {
            if (command.type === Commands.NOTE_ON) {
                noteOnCommands.push(command)
                this.heldNotes.add(command.number)
                this.noteOnTimes.set(command.number, command.startAt || 0)
            } else if (command.type === Commands.NOTE_OFF) {
                // Generate NOTE_OFF for all arpeggiated notes from this original note
                const arpeggiatedNotes = this.arpeggiatedNotesMap.get(command.number)

                console.log('[ARPEGGIATOR] NOTE_OFF received', {
                    originalNote: command.number,
                    arpeggiatedNotes: arpeggiatedNotes ? arpeggiatedNotes.map(n => n.noteNumber) : []
                })

                if (arpeggiatedNotes) {
                    // Create NOTE_OFF for each unique arpeggiated note
                    // Use a Set to avoid duplicate NOTE_OFFs for the same note number
                    const uniqueNoteNumbers = new Set<number>()
                    const currentTime = command.time

                    arpeggiatedNotes.forEach(({noteNumber, startAt}) => {
                        // Only send NOTE_OFF once per unique note number
                        if (!uniqueNoteNumbers.has(noteNumber)) {
                            uniqueNoteNumbers.add(noteNumber)

                            const noteOffCmd = new AudioCommand()
                            noteOffCmd.type = Commands.NOTE_OFF
                            noteOffCmd.subtype = Commands.NOTE_OFF
                            noteOffCmd.number = noteNumber
                            noteOffCmd.velocity = command.velocity || 100
                            noteOffCmd.time = currentTime

                            // NOTE_OFF happens immediately when user releases
                            // Don't schedule it - let it execute right away
                            noteOffCmd.startAt = currentTime

                            console.log('[ARPEGGIATOR] Generating NOTE_OFF', {
                                noteNumber,
                                velocity: noteOffCmd.velocity,
                                noteOnStartAt: startAt,
                                currentTime,
                                noteOffStartAt: noteOffCmd.startAt
                            })

                            arpeggiated.push(noteOffCmd)
                        }
                    })

                    // Clear the mapping
                    this.arpeggiatedNotesMap.delete(command.number)
                }

                this.heldNotes.delete(command.number)
                this.noteOnTimes.delete(command.number)
            } else {
                otherCommands.push(command)
            }
        }

        console.log('[ARPEGGIATOR] Detected commands', {
            noteOnCount: noteOnCommands.length,
            heldNotes: Array.from(this.heldNotes),
            pattern: this.config.pattern
        })

        // If we have multiple note-on commands at the same time, treat as chord
        if (noteOnCommands.length > 1) {
            console.log('[ARPEGGIATOR] CHORD DETECTED - generating arpeggio', {
                chordSize: noteOnCommands.length,
                notes: noteOnCommands.map(c => c.number)
            })

            // Use the first command as the template for timing
            const templateCommand = noteOnCommands[0]
            const arpeggio = this.generateArpeggio(templateCommand, bpm)

            console.log('[ARPEGGIATOR] Generated arpeggio', {
                inputNotes: noteOnCommands.length,
                outputCommands: arpeggio.length,
                bpm
            })

            // Track which arpeggiated notes came from which original notes
            // All original notes in the chord share the same arpeggiated notes
            const arpeggiatedNotesData = arpeggio.map(cmd => ({
                noteNumber: cmd.number,
                startAt: cmd.startAt
            }))

            // Store the chord members so we can clear them all when any note is released
            const chordMembers = noteOnCommands.map(c => c.number)

            // Only the first note gets the full mapping, others get empty to prevent duplicates
            this.arpeggiatedNotesMap.set(noteOnCommands[0].number, arpeggiatedNotesData)

            // Store chord members reference for cleanup
            for (let i = 1; i < noteOnCommands.length; i++) {
                this.arpeggiatedNotesMap.set(noteOnCommands[i].number, [])
            }

            console.log('[ARPEGGIATOR] Tracking arpeggiated notes', {
                originalNotes: chordMembers,
                primaryNote: noteOnCommands[0].number,
                arpeggiatedNotes: arpeggiatedNotesData.map(n => `${n.noteNumber}@${n.startAt.toFixed(3)}s`)
            })

            arpeggiated.push(...arpeggio)
        } else if (noteOnCommands.length === 1) {
            // Single note - check if there are already held notes to arpeggiate
            if (this.heldNotes.size > 1) {
                console.log('[ARPEGGIATOR] Single note added to existing chord - generating arpeggio', {
                    totalHeldNotes: this.heldNotes.size,
                    bpm
                })
                const arpeggio = this.generateArpeggio(noteOnCommands[0], bpm)

                // Track arpeggiated notes with timing
                const arpeggiatedNotesData = arpeggio.map(cmd => ({
                    noteNumber: cmd.number,
                    startAt: cmd.startAt
                }))
                this.arpeggiatedNotesMap.set(noteOnCommands[0].number, arpeggiatedNotesData)

                arpeggiated.push(...arpeggio)
            } else {
                console.log('[ARPEGGIATOR] Single note - pass through')
                // Track that this note maps to itself with its original timing
                this.arpeggiatedNotesMap.set(noteOnCommands[0].number, [{
                    noteNumber: noteOnCommands[0].number,
                    startAt: noteOnCommands[0].startAt || noteOnCommands[0].time
                }])
                arpeggiated.push(noteOnCommands[0])
            }
        }

        // Add other commands (note-offs, etc.)
        arpeggiated.push(...otherCommands)

        console.log('[ARPEGGIATOR] Transform complete', {
            inputCount: commands.length,
            outputCount: arpeggiated.length,
            output: arpeggiated
        })

        return arpeggiated
    }

    /**
     * Generate arpeggiated note sequence from held notes
     */
    private generateArpeggio(originalCommand: AudioCommandInterface, bpm: number): AudioCommandInterface[] {
        const baseNotes = Array.from(this.heldNotes).sort((a, b) => a - b)

        if (baseNotes.length === 0) {
            return [originalCommand]
        }

        // Chord mode: play all notes simultaneously
        if (this.config.pattern === 'chord') {
            return baseNotes.map(noteNumber => this.createCommand(originalCommand, noteNumber, 0, originalCommand.time))
        }

        // Build full note sequence including octaves
        const fullSequence = this.buildNoteSequence(baseNotes)

        // Apply pattern to the sequence
        const patternedSequence = this.applyPattern(fullSequence)

        // Create delayed commands for each note in the sequence
        // Use the current time from the command as the base time
        const baseTime = originalCommand.time
        const delayMs = this.calculateDelayMs(this.config.rate, bpm)

        const result = patternedSequence.map((noteNumber, index) => {
            const delay = index * delayMs
            const cmd = this.createCommand(originalCommand, noteNumber, delay, baseTime)
            console.log('[ARPEGGIATOR] Creating arpeggio note', {
                index,
                noteNumber,
                delayMs: delay,
                baseTime,
                rate: this.config.rate,
                bpm,
                calculatedDelayMs: delayMs,
                originalStartAt: originalCommand.startAt,
                newStartAt: cmd.startAt,
                originalTime: originalCommand.time
            })
            return cmd
        })
        return result
    }

    /**
     * Build note sequence including octave spans
     */
    private buildNoteSequence(baseNotes: number[]): number[] {
        if (this.config.octaves === 1) {
            return baseNotes
        }

        const extended: number[] = []
        for (let octave = 0; octave < this.config.octaves; octave++) {
            const octaveOffset = octave * 12
            for (const note of baseNotes) {
                const transposed = note + octaveOffset
                // Keep within MIDI range (0-127)
                if (transposed <= 127) {
                    extended.push(transposed)
                }
            }
        }

        return extended
    }

    /**
     * Apply arpeggio pattern to note sequence
     */
    private applyPattern(notes: number[]): number[] {
        switch (this.config.pattern) {
            case 'up':
                return notes

            case 'down':
                return [...notes].reverse()

            case 'up-down':
                // Avoid duplicating the top note
                const downPart = [...notes].reverse().slice(1)
                return [...notes, ...downPart]

            case 'down-up':
                // Avoid duplicating the bottom note
                const upPart = [...notes].slice(1)
                return [[...notes].reverse(), ...upPart].flat()

            case 'random':
                return shuffleArray([...notes])

            default:
                return notes
        }
    }


    /**
     * Create a new audio command with specified note and delay
     */
    private createCommand(
        original: AudioCommandInterface,
        noteNumber: number,
        delayMs: number,
        baseTime: number
    ): AudioCommandInterface {

        const command = original.clone()

        // Set the arpeggiated note number
        command.number = noteNumber

        // Apply timing delay (in milliseconds converted to seconds for audio context)
        // Use baseTime (current audio context time) as the reference point
        const delaySeconds = delayMs / 1000
        command.startAt = baseTime + delaySeconds
        command.endAt = original.endAt

        // console.log('[ARPEGGIATOR] Command created', {
        //     noteNumber,
        //     velocity: command.velocity,
        //     originalVelocity: original.velocity,
        //     startAt: command.startAt
        // })

        return command
    }

    /**
     * Reset arpeggiator state (useful when stopping playback)
     */
    reset(): void {
        this.heldNotes.clear()
        this.noteOnTimes.clear()
        this.arpeggiatedNotesMap.clear()
        this.currentArpIndex = 0
    }
}
