import type { AudioCommandInterface } from "../audio-command-interface"

export interface TransformerConfig {

}

export interface FieldConfig {
    name: string
    type: string
    values: Array<string | number | { name: string; value: string | number }>
}

export abstract class Transformer<Config = TransformerConfig> {
    
    static ID:number = 0

    static getUniqueID() {
        return "Transformer-" + (++Transformer.ID)
    }
    
    public id: string = Transformer.getUniqueID()
    
    protected config: Config

    get fields(): FieldConfig[] {
        return []
    }

    abstract get name(): string

    constructor(config: Config) {
        this.config = config
        if (!this.id)
        {
            throw Error("No ID specified for this Transformer!")
        }
    }

    abstract transform(commands: AudioCommandInterface[]): AudioCommandInterface[]

    setConfig(c: string, val: unknown):void {
        this.config[c] = val
    }
}