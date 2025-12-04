import type { AudioCommandInterface } from "../audio-command-interface"
import type Timer from "../timing/timer"

export interface TransformerInterface {
    name:string
    description:string
    id: string
    fields: FieldConfig[]
    transform(commands: AudioCommandInterface[], timer:Timer ): AudioCommandInterface[]
    reset():void
}

export interface FieldConfig {
    name: string
    type: string
    enabled:boolean
    values: Array<string | number | { name: string; value: string | number }>
}
