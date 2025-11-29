import type AudioCommand from "../audio-command";
import { Transformer } from "./abstract-transformer"

export class TransformerQuantise extends Transformer<{}>{

    constructor(config: {}) {
        super(config)
    }

    transform( command:AudioCommand ):AudioCommand{
        return command
    }
}