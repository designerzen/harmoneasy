/**
 * Take note Ons and detune the note to match the specified
 * microtonal scale.
 */
import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"

import type { TransformerInterface } from "./transformer-interface.ts"
import { Transformer } from "./abstract-transformer.ts"

export class MicroTonalityTransformer extends Transformer<{}> implements TransformerInterface{
 
    get name(): string {
        return 'Micro Tonality Transformer'
    }
 
    transform( command:AudioCommand[], timer:Timer ): AudioCommand[] {
        return command
    }
}