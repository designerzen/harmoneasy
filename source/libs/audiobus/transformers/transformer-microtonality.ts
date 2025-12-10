/**
 * Take note Ons and detune the note to match the specified
 * microtonal scale.
 */
import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"

import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"
import { parseEdoScaleMicroTuningOctave } from "../../pitfalls/ts/index.ts"
import { TRANSFORMER_CATEGORY_TUNING } from "./transformer-categories.ts"

export const ID_MICROTONALITY = "Micro-Tonality" 


// const detune = mictrotonalPitches.freqs[noteModel.noteNumber]
// const microntonal = noteModel.clone()
// microntonal.detune = detune
// synth.noteOn( microntonal, 1 )
// console.warn( "TEST", mictrotonalPitches, 60, 3, "LLsLLLs", 2, 1 )

export class MicroTonalityTransformer extends Transformer<{}> implements TransformerInterface{
 
    protected type = ID_MICROTONALITY
	category = TRANSFORMER_CATEGORY_TUNING
    
    get name(): string {
        return 'Micro Tonality Transformer'
    }

    get description():string{
        return "Detune to a specific microtonal scale"
    }

    constructor(config:Config){
        super(config)
        const mictrotonalPitches = parseEdoScaleMicroTuningOctave(60, 3, "LLsLLLs", 2, 1)
    }

    /**
     * 
     * @param commands 
     * @param timer 
     * @returns 
     */
    transform( commands:AudioCommand[], timer:Timer ): AudioCommand[] {
          
        if (!this.config.enabled || commands.length === 0)
        {
            return commands
        }
        return commands
    }
}