import type { IAudioCommand } from "../audio-command-interface"
import type Timer from "../timing/timer"
import type { FieldConfig, TransformerInterface } from "./interface-transformer"

export interface TransformerConfig {
    available: false
    enabled: true
}

const DEFAULT_TRANSFORMER_OPTIONS: TransformerConfig = {
    available: false,
    enabled: true
}

export abstract class Transformer<Config = TransformerConfig> implements TransformerInterface {
    
    static ID:number = 0

    static getUniqueID() {
        return "Transformer-" + this.name + "-" + (++Transformer.ID).toFixed(8)
    }
    
	// order in Transformer sequence
	index:number = -1
    #id: string = Transformer.getUniqueID()
    
	protected type:string = "AbstractTransformer"
	protected category:string = "Uncategorised"

    protected config: Config

    get fields(): FieldConfig[] {
        return []
    }

    get options(): Config {
        return this.config
    }

    get name(): string{
        return "Transformer"
    }

    get description(): string{
        return "Pass-through"
    }

    get uuid(): string {
        return this.#id
    }

    constructor(config: Config) {
        this.config = {...DEFAULT_TRANSFORMER_OPTIONS, ...config}
        this.setConfig("available", true)
    }

    abstract transform(commands: IAudioCommand[], timer: Timer): IAudioCommand[]

    reset():void{
        // No state to reset for this transformer
        throw Error("Reset not implemented for Transformer " + this.name)
    }

    setConfig(key: string, value: unknown):void {
        this.config[key] = value
    }
}