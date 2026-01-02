import type NoteModel from "../note-model.ts"

export interface IAudioOutput{
	get name():string
	noteOn(note: NoteModel, velocity: number): void
	noteOff(note: NoteModel): void
	allNotesOff(): void
}
