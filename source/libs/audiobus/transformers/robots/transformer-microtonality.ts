/**
 * Take note Ons and detune the note to match the specified
 * microtonal scale.
 */
import type AudioCommand from "../../audio-command.ts"
import type Timer from "../../timing/timer.ts"

import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"
import { parseEdoScaleMicroTuningOctave } from "../../../pitfalls/ts/index.ts"
import { TRANSFORMER_CATEGORY_TUNING } from "./transformer-categories.ts"

export const ID_MICROTONALITY = "Micro-Tonality" 

const DEFAULT_OPTIONS = {
	
}


// const detune = mictrotonalPitches.freqs[noteModel.noteNumber]
// const microntonal = noteModel.clone()
// microntonal.detune = detune
// synth.noteOn( microntonal, 1 )
// console.warn( "TEST", mictrotonalPitches, 60, 3, "LLsLLLs", 2, 1 )

export class TransformerMicroTonality extends Transformer<{}> implements TransformerInterface{
 
    protected type = ID_MICROTONALITY
	category = TRANSFORMER_CATEGORY_TUNING
    
    baseNoteMidi: number = 60
    rootOctave: number = 3
    sequence: string = "LLsLLLs"
    large: number = 2
    small: number = 1
    rootFrequency: number = 440

    get name(): string {
        return 'Microtonality'
    }

    get description():string{
        return "Detune to a specific microtonal scale"
    }

    get fields() {
        return [
            {
                name: 'enabled',
                type: 'select',
                values: [
                    { name: 'On', value: 1 },
                    { name: 'Off', value: 0 }
                ]
            },
            {
                name: 'baseNoteMidi',
                type: 'number',
                min: 0,
                max: 127,
                value: this.baseNoteMidi
            },
            {
                name: 'rootOctave',
                type: 'select',
                values: [
                    { name: '0', value: 0 },
                    { name: '1', value: 1 },
                    { name: '2', value: 2 },
                    { name: '3', value: 3 },
                    { name: '4', value: 4 },
                    { name: '5', value: 5 },
                    { name: '6', value: 6 },
                    { name: '7', value: 7 },
                    { name: '8', value: 8 },
                    { name: '9', value: 9 },
                    { name: '10', value: 10 }
                ]
            },
            {
                name: 'sequence',
                type: 'text',
                value: this.sequence
            },
            {
                name: 'large',
                type: 'select',
                values: [
                    { name: '1', value: 1 },
                    { name: '2', value: 2 },
                    { name: '3', value: 3 },
                    { name: '4', value: 4 },
                    { name: '5', value: 5 },
                    { name: '6', value: 6 },
                    { name: '7', value: 7 },
                    { name: '8', value: 8 },
                    { name: '9', value: 9 },
                    { name: '10', value: 10 },
                    { name: '11', value: 11 },
                    { name: '12', value: 12 }
                ]
            },
            {
                name: 'small',
                type: 'select',
                values: [
                    { name: '1', value: 1 },
                    { name: '2', value: 2 },
                    { name: '3', value: 3 },
                    { name: '4', value: 4 },
                    { name: '5', value: 5 },
                    { name: '6', value: 6 },
                    { name: '7', value: 7 },
                    { name: '8', value: 8 },
                    { name: '9', value: 9 },
                    { name: '10', value: 10 },
                    { name: '11', value: 11 },
                    { name: '12', value: 12 }
                ]
            },
            {
                name: 'rootFrequency',
                type: 'number',
                min: 20,
                max: 20000,
                value: this.rootFrequency
            }
        ]
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
	/**
	 * 
	 * @param key 
	 * @param value 
	 */
	override setConfig(key: string, value: unknown): void {
		super.setConfig(key, value)
		this.mictrotonalPitches = parseEdoScaleMicroTuningOctave(60, 3, "LLsLLLs", 2, 1)
	}	 
}
