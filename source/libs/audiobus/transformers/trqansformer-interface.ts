import type { AudioCommandInterface } from "../audio-command-interface"
import type Timer from "../timing/timer"

export interface TransformerInterface {
    id: string
    fields: FieldConfig[]
    transform(commands: AudioCommandInterface[], timer:Timer ): AudioCommandInterface[]
}

export interface FieldConfig {
    name: string
    type: string
    values: Array<string | number | { name: string; value: string | number }>
}

export interface TransformerConfig {

}