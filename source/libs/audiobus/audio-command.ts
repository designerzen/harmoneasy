import type { AudioCommandInterface } from "./audio-command-interface"

/**
* A single musical command.
* 
* This can be used to send a command to any part
* of the audio application in order to trigger something
* or change parameters.
* 
* Essentially this is a musical event which hasn't been
* triggered and so doesn't have a real timestamp
*/
export default class AudioCommand implements AudioCommandInterface {

	static counter = 1

    get noteNumber():number{
        return this.number
    }

	// pitch value 0 -> 16383
	get pitch():number{
		return this.value
	}
	
	// MIDI GM Note number for setting pitch
    number:number

	// velocity / amplitude value
    velocity:number
    startAt:number
    endAt:number

	// pitch value from MIDI is 0 -> 16383
	value:number
	pitchBend:number = 0

	// UNOFFICAl: Uint8Array
	raw:Uint8Array
	// data:

	time:number = 0
	timeCode:number = 0

	// Handy places to store information about this command
	id:number
	type:string
	subtype:string

	text:string
	from:string
	
	constructor() {
		this.id = AudioCommand.counter++
	}

	// for linked lists
	previous:AudioCommand
	next:AudioCommand

	remove(){
		this.previous.next = this.next
		this.next.previous = this.previous
	}

	append(tail:AudioCommand){
		tail.next = this
		this.previous = tail
	}

	/**
	 * 
	 * @returns copy of this
	 */
	clone():AudioCommand{
		return this.copyAllParametersToCommand( new AudioCommand() )
	}

	copyAllParametersToCommand(command:AudioCommand):AudioCommand{
		for (let i in this)
		{
			command[i] = this[i]
		}
		return command
	}
	copyAllParametersFromCommand(command:AudioCommand):AudioCommand{
		for (let i in this)
		{
			this[i] = command[i]
		}
		return command
	}

	/**
	 * Show characteristics about this data 
	 * @returns {string}
	 */
	toString():string {
		let output = `#${this.id} = ${this.time}. MIDI:Input::${this.subtype} Type:${this.type}`
		if (this.noteNumber) { output += ` Note:${this.noteNumber}` }
		if (this.velocity) { output += ` Velocity:${this.velocity}` }
		return output + '\n'
	}
}
