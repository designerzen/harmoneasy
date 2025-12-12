/**
 * This simply adds a noteOff to any noteOn that has lasted more 
 * than the specified bar lengths
 */
import type AudioCommand from "../../audio-command.ts"
import type Timer from "../../timing/timer.ts"
import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"
import { TRANSFORMER_CATEGORY_TIMING } from "./transformer-categories.ts"

const ID_KILL_OLD = 'kill-old'

export class KillOldTransformer extends Transformer<{}> implements TransformerInterface{
   
	id = ID_KILL_OLD
    protected type = ID_KILL_OLD
	category = TRANSFORMER_CATEGORY_TIMING

    get name(): string {
        return 'Kill Old Transformer'
    }
   
    get description():string{
        return "Remove stale & everlasting notes"
    }

    transform(commands: AudioCommand[], timer:Timer): AudioCommand[] {
         if (!this.config.enabled || commands.length === 0)
        {
            return commands
        }

        // check to see how old this command is
        return commands
    }
}