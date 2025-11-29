/**
* A single musical command.
* This can be used to send a command to any part
* of the audio application in order to trigger something
* or change parameters
*/
export default class AudioCommand {

	static counter = 1

    get noteNumber(){
        return this.number
    }

	// pitch value 0 -> 16383
	get pitch(){
		return this.value
	}
	
	get duration(){
		return this.endAt - this.startAt
	}

   
	// MIDI GM Note number for setting pitch
    number

	// velocity / amplitude value
    velocity
    startAt
    endAt

	// pitch value from MIDI is 0 -> 16383
	value
	pitchBend = 0

	// UNOFFICAl: Uint8Array
	raw

	time = 0
	timeCode = 0

	// Handy places to store information about this command
	id 
	type
	subtype
	text
	data

	constructor() {
		this.id = AudioCommand.counter++
	}

	// for linked lists
	previous
	next

	remove(){
		this.previous.next = this.next
		this.next.previous = this.previous
	}

	append(tail){
		tail.next = this
		this.previous = tail
	}

	/**
	 * 
	 * @returns copy of this
	 */
	clone(){
		return this.copyAllParametersToCommand( new AudioCommand() )
	}

	copyAllParametersToCommand(command){
		for (let i in this)
		{
			command[i] = this[i]
		}
		return command
	}

	/**
	 * Show characteristics about this data 
	 * @returns {string}
	 */
	toString() {
		let output = `#${this.id} = ${this.time}. MIDI:Input::${this.subtype} Type:${this.type}`
		if (this.noteNumber) { output += ` Note:${this.noteNumber}` }
		if (this.velocity) { output += ` Velocity:${this.velocity}` }
		return output + '\n'
	}
}
