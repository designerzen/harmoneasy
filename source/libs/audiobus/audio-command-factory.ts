import AudioCommand from "./audio-command.ts"
import type NoteModel from "./note-model"
import { encode, decode } from '@msgpack/msgpack'

/**
 * 
 * @param type 
 * @param noteModel 
 * @param timer 
 * @param fromDevice 
 * @returns 
 */
export const createAudioCommand = (type:string, noteModel:NoteModel, timer:any,  fromDevice:string="Unknown" ):AudioCommand => {

     // create an AudioCommand for this NoteModel
    const audioCommand = new AudioCommand()
    audioCommand.type = type
    audioCommand.subtype = type
    audioCommand.number = noteModel.noteNumber
    audioCommand.value = noteModel.noteNumber
    audioCommand.velocity = 100 // Fixed: was incorrectly set to noteNumber
    audioCommand.time = timer.now
    audioCommand.startAt = timer.now
    audioCommand.from = fromDevice

    return audioCommand
}

/**
 * Encode AudioCommand to MessagePack binary
 * @param command 
 * @returns 
 */
export const encodeAudioCommand = (command: AudioCommand): Uint8Array => {
  return encode(command)
}

/**
 * Decode AudioCommand from MessagePack binary
 */
export const decodeAudioCommand = (data: Uint8Array | ArrayBuffer): AudioCommand => {
  const decoded = decode(data)
  const command = new AudioCommand()
  Object.assign(command, decoded)
  return command
}