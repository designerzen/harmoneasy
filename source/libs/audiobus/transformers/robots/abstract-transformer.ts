import type { IAudioCommand } from "../../audio-command-interface.ts"
import type Timer from "../../timing/timer.ts"
import type { FieldConfig, ITransformer } from "./interface-transformer.ts"

export interface TransformerConfig {
    available: false
    enabled: true
}

const DEFAULT_TRANSFORMER_OPTIONS: TransformerConfig = {
    available: false,
    enabled: true
}

export abstract class Transformer<Config = TransformerConfig> implements ITransformer {
    
    static ID:number = 0

    static getUniqueID() {
		return `Transformer-${this.name}-${++Transformer.ID}`
        // return "Transformer-" + this.name + "-" + String(Transformer.ID).padStart(16, "0")
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

    constructor(config: Config = DEFAULT_TRANSFORMER_OPTIONS) {
        this.config = {...DEFAULT_TRANSFORMER_OPTIONS, ...config}
        this.setFieldDefaults( this.config )
        this.setConfig("available", true)
    }

	exportConfig(): string {
		return JSON.stringify({...this.config, type:this.type })
	}

	/**
	 *  loop through and set the default fields in the config
	 * @param config 
	 */
	setFieldDefaults(config: Config):void{
		for (const field of this.fields) {
			if (config[field.name] !== undefined) {
				field.default = config[field.name]
			}
		}
	}

	/**
	 * Overwrite a field in the config (and cause side effects)
	 * @param key 
	 * @param value 
	 */
    setConfig(key: string, value: unknown):void {
        this.config[key] = value
    }

	abstract transform(commands: IAudioCommand[], timer: Timer): IAudioCommand[]

    reset():void{
        // No state to reset for this transformer
        throw Error("Reset not implemented for Transformer " + this.name)
    }

	destroy():void{
	
	}
}