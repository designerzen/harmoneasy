/**
 * Take note Ons and detune the note to match the specified
 * microtonal scale.
 */
import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"

import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"

export const ID_MICROTONALITY = "Micro-Tonality" 

export class MicroTonalityTransformer extends Transformer<{}> implements TransformerInterface{
 
    id = ID_MICROTONALITY
    
    get name(): string {
        return 'Micro Tonality Transformer'
    }

    get description():string{
        return "Detune to a specific microtonal scale"
    }

    transform( commands:AudioCommand[], timer:Timer ): AudioCommand[] {
          
        if (!this.config.enabled || commands.length === 0)
        {
            return commands
        }
        return commands
    }
}