import type { AudioCommandInterface } from "../audio-command-interface"
import { Transformer } from "./abstract-transformer"
import AudioCommand from "../audio-command"
import * as Commands from "../../../commands"
import type Timer from "../timing/timer"

export const ID_NOTE_SHORTENER = "note-shortener"

interface Config {
    enabled: boolean
    duration: number // milliseconds - how long the note plays before NOTE_OFF
}

const DEFAULT_OPTIONS: Config = {
    enabled: true,
    duration: 125, // 125ms = 16th notes at 120 BPM
}

/**
 * Note Shortener Transformer
 *
 * Shortens the duration of notes by generating NOTE_OFF commands after a fixed delay.
 * The delay is configurable based on beat speed (e.g., 1/16, 1/8, etc.).
 */
export class TransformerNoteShortener extends Transformer<Config> {

    id = ID_NOTE_SHORTENER

    // Track NOTE_ON commands with their scheduled NOTE_OFF times
    private noteOnMap: Map<number, {startAt: number, originalEndAt?: number}> = new Map()

    get name(): string {
        return 'Note Shortener'
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
                name: 'duration',
                type: 'select',
                values: [
                    { name: '1/32', value: 62.5 },
                    { name: '1/16', value: 125 },
                    { name: 'Triplet', value: 166.67 },
                    { name: '1/8', value: 250 },
                    { name: '1/4', value: 500 }
                ]
            }
        ]
    }

    constructor(config: Partial<Config> = {}) {
        super({ ...DEFAULT_OPTIONS, ...config })
    }

    transform(commands: AudioCommandInterface[], timer:Timer ): AudioCommandInterface[] {
        if (!this.config.enabled || commands.length === 0) {
            return commands
        }

        const shortened: AudioCommandInterface[] = []

        for (const command of commands) {
            if (command.type === Commands.NOTE_ON) {
                // Generate both NOTE_ON and immediate NOTE_OFF with delay
                const noteOnTime = command.startAt || command.time

                // Add the original NOTE_ON
                shortened.push(command)

                // Create a NOTE_OFF scheduled after the configured duration
                const noteOffCmd = new AudioCommand()
                noteOffCmd.type = Commands.NOTE_OFF
                noteOffCmd.subtype = Commands.NOTE_OFF
                noteOffCmd.number = command.number
                noteOffCmd.velocity = command.velocity || 100
                noteOffCmd.time = command.time

                // Convert duration from milliseconds to seconds and schedule NOTE_OFF
                const durationSeconds = this.config.duration / 1000
                noteOffCmd.startAt = noteOnTime + durationSeconds

                shortened.push(noteOffCmd)

                // Track that we've handled this note
                this.noteOnMap.set(command.number, {
                    startAt: noteOnTime
                })

            } else if (command.type === Commands.NOTE_OFF) {
                // Skip the original NOTE_OFF since we already generated one
                // Just clean up the tracking
                this.noteOnMap.delete(command.number)
            } else {
                // Other commands pass through unchanged
                shortened.push(command)
            }
        }

        return shortened
    }

    reset(): void {
        this.noteOnMap.clear()
    }
}
