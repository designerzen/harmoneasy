import type { AudioCommandInterface } from "../audio-command-interface"

export interface TransformerConfig {

}

export abstract class Transformer<Config = TransformerConfig> {
    
    static ID:number = 0

    static getUniqueID() {
        return "Transformer-" + (++Transformer.ID)
    }
    
    public id: string = Transformer.getUniqueID()
    
    protected config: Config

    constructor(config: Config) {
        this.config = config
        if (!this.id)
        {
            throw Error("No ID specified for this Transformer!")
        }
    }

    abstract get name(): string

    abstract transform(command: AudioCommandInterface[]): AudioCommandInterface[]
}