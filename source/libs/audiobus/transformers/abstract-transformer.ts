import type { AudioCommandInterface } from "../audio-command-interface"
import type Timer from "../timing/timer"
import type { FieldConfig, TransformerConfig, TransformerInterface } from "./transformer-interface"

export abstract class Transformer<Config = TransformerConfig> implements TransformerInterface {
    
    static ID:number = 0

    static getUniqueID() {
        return "Transformer-" + this.name + "-" + (++Transformer.ID).toFixed(8)
    }
    
    public id: string = Transformer.getUniqueID()
    
    protected config: Config

    get fields(): FieldConfig[] {
        return []
    }

    get options(): Config {
        return this.config
    }

    get name(): string{
        return this.id
    }

    constructor(config: Config) {
        this.config = config
    }

    abstract transform(commands: AudioCommandInterface[], timer: Timer): AudioCommandInterface[]

    reset():void{
        // No state to reset for this transformer
    }

    setConfig(c: string, val: unknown):void {
        this.config[c] = val
    }
}