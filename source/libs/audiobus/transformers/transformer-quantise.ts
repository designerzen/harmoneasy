import type { AudioCommandInterface } from "../audio-command-interface";
import type Timer from "../timing/timer";
import { Transformer } from "./abstract-transformer"

export const ID_QUANTISE = "quantise"

interface Config {
    step: number
}

const DEFAULT_OPTIONS: Config = {
   step: 4
}

export class TransformerQuantise extends Transformer<{ step: number }>{

    id = ID_QUANTISE

    get name(): string {
        return 'Quantiser'
    }

    get fields() {
        return [
            { 
                name: 'step', 
                type: 'select', 
                values: [
                    1, 2, 3, 4, 6, 8, 12, 16 ]
            }
        ]
    }

    constructor(config = { step: 4 }) {
        super( {...DEFAULT_OPTIONS, ...config} )
    }

    // Quanitisation is handles in onTick in index
    transform(commands:AudioCommandInterface[], timer: Timer):AudioCommandInterface[] {
        return commands
    }
}