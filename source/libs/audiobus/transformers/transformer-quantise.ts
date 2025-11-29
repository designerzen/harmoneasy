import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer"

export const ID_QUANTISE = "quantise"

export class TransformerQuantise extends Transformer<{}>{

    id = ID_QUANTISE

    constructor(config: {}) {
        super(config)
    }

    transform(commands:AudioCommandInterface[]):AudioCommandInterface[] {
        return commands
    }

    get name(): string {
        return 'Quantise'
    }
}