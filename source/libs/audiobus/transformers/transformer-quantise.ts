import type { AudioCommandInterface } from "../audio-command-interface";
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
            { name: 'step', type: 'select', values: [1, 4, 8, 12] }
        ]
    }

    constructor(config = { step: 4 }) {
        super( {...DEFAULT_OPTIONS, ...config} )
    }

    transform(commands:AudioCommandInterface[]):AudioCommandInterface[] {
        return commands
    }
}