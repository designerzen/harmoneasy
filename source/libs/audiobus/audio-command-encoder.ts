import { encode } from '@msgpack/msgpack'
import type AudioCommand from './audio-command'

/**
 * Encode AudioCommand to MessagePack binary
 * @param command 
 * @returns 
 */
export const encodeAudioCommand = (command: AudioCommand): Uint8Array => {
  return encode(command)
}