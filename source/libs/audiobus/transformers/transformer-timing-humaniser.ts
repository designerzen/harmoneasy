/**
 * Adds a bit of off grid wobble to your timinig
 */

import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"
import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"
import { TRANSFORMER_CATEGORY_TIMING } from "./transformer-categories.ts"

export const ID_TIMING_HUMANISER = "TimingHumaniser"

export class TransformerTimingHumaniser extends Transformer<{}> implements TransformerInterface{
    
	protected type = ID_TIMING_HUMANISER

	category = TRANSFORMER_CATEGORY_TIMING
	
	get name(): string {
        return 'Timing Humaniser Transformer'
    }

	get description():string{
        return "Adds a bit of off grid wobble to your timing."
    }
	
    transform(command: AudioCommand[], timer:Timer): AudioCommand[] {
        return command
    }
}