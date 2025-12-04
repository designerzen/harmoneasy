import type { AudioCommandInterface } from "../audio-command-interface"
import type Timer from "../timing/timer"
import type { FieldConfig, TransformerConfig, TransformerInterface } from "./interface-transformer"



export interface TransformerConfig {
    available: false
    enabled: true
}

const DEFAULT_OPTIONS: TransformerConfig = {
    available: false,
    enabled: true
}

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
    get description(): string{
        return "Pass-through"
    }

    constructor(config: Config) {
        this.config = {...DEFAULT_OPTIONS, ...config}
        this.setConfig("available", true)
    }

    abstract transform(commands: AudioCommandInterface[], timer: Timer): AudioCommandInterface[]

    reset():void{
        // No state to reset for this transformer
    }

    setConfig(c: string, val: unknown):void {
        this.config[c] = val
    }
}