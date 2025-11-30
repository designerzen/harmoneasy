import type { AudioCommandInterface } from "../audio-command-interface"
import type Timer from "../timing/timer"
import type { FieldConfig, TransformerConfig, TransformerInterface } from "./trqansformer-interface"


export abstract class Transformer<Config = TransformerConfig> implements TransformerInterface {
    
    static ID:number = 0

    static getUniqueID() {
        return "Transformer-" + (++Transformer.ID)
    }
    
    public id: string = Transformer.getUniqueID()
    
    protected config: Config

    get fields(): FieldConfig[] {
        return []
    }

    get options(): Config {
        return this.config
    }

    abstract get name(): string

    constructor(config: Config) {
        this.config = config
        if (!this.id)
        {
            throw Error("No ID specified for this Transformer!")
        }
    }

    abstract transform(commands: AudioCommandInterface[], timer: Timer): AudioCommandInterface[]

    setConfig(c: string, val: unknown):void {
        this.config[c] = val
    }
}