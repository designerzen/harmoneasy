/**
 * This simply adds a noteOff to any noteOn that has lasted more 
 * than the specified bar lengths
 */
import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"
import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"

export class KillOldTransformer extends Transformer<{}> implements TransformerInterface{
   
    get name(): string {
        return 'Kill Old Transformer'
    }
   
    get description():string{
        return "Remove stale & everlasting notes"
    }

    transform(command: AudioCommand[], timer:Timer): AudioCommand[] {
       // check to see how old this command is
        return command
    }
}