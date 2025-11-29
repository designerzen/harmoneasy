import AudioCommand from "./audio-command.ts"
import type NoteModel from "./note-model"

export const createAudioCommand = (type:string, noteModel:NoteModel, timer:any ):AudioCommand => {

     // create an AudioCommand for this NoteModel
    const audioCommand = new AudioCommand()
    audioCommand.type = type
    audioCommand.subtype = type
    audioCommand.number = noteModel.noteNumber
    audioCommand.value = noteModel.noteNumber
    audioCommand.velocity = 100 // Fixed: was incorrectly set to noteNumber
    audioCommand.time = timer.now

    return audioCommand
}