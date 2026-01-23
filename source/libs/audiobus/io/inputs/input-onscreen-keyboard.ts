
import AbstractInput from "./abstract-input"
import AudioCommand from "../../audio-command"
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from "../../../../commands"
import SVGKeyboard from "../../../../components/keyboard-svg.js"
import NoteModel from "../../note-model.js"

import type { IAudioInput } from "./input-interface.js"

const keyboardKeys = (new Array(128)).fill("")
export const ALL_KEYBOARD_NUMBERS = keyboardKeys.map((_, index) => index )
export const ALL_KEYBOARD_NOTES = keyboardKeys.map((keyboardKeys, index) => new NoteModel(index))

export const ONSCREEN_KEYBOARD_INPUT_ID = "OnscreenKeyboard"

const DEFAULT_OPTIONS = {
	keys:ALL_KEYBOARD_NOTES
}

export default class InputOnScreenKeyboard extends AbstractInput implements IAudioInput{
	
	#keyboard:SVGKeyboard
	keyboardElement:HTMLElement | null = null

	get name():string {
		return ONSCREEN_KEYBOARD_INPUT_ID
	}

	get description():string {
		return "Onscreen Keyboard"
	}

	get keyboard():SVGKeyboard{
		return this.#keyboard
	}

	get isHidden(): boolean {
		return false
	}

	constructor( options:Record<string, any> = DEFAULT_OPTIONS ) { 
		super({...DEFAULT_OPTIONS,...options})
		const keys = this.options.keys
		this.onKeyDown = this.onKeyDown.bind(this)
		this.onKeyUp = this.onKeyUp.bind(this)
		this.#keyboard = new SVGKeyboard(keys, this.onKeyDown, this.onKeyUp)
		this.setAsConnected()
	}

	async createGui(): Promise<HTMLElement> {
		const container = document.querySelector("main")

		if( container === null ) 
		{
			throw new Error("Could not find main container element")
		}

		// inject into DOM on specified element 
		this.keyboardElement = container.appendChild( this.#keyboard.element )
		return this.keyboardElement
	}

	async destroyGui(): Promise<void> {
		if( this.keyboardElement !== null ) {
			this.keyboardElement.remove()
		}
		return Promise.resolve()
	}
	
	/**
	 * KILL
	 */
	override destroy(): void {
		this.#keyboard.allNotesOff()
		this.setAsDisconnected()
	}

	/**
	 * 
	 * @param noteNumber 
	 * @param velocity 
	 */
	onKeyDown(noteNumber:number, velocity:number){
		const command:AudioCommand = new AudioCommand()
		command.type = NOTE_ON
		command.velocity = velocity
		command.number = noteNumber
		command.from = ONSCREEN_KEYBOARD_INPUT_ID
		command.startAt = this.now
		command.time = this.now
		this.dispatch( command )
	}

	/**
	 * 
	 * @param noteNumber 
	 * @param velocity 
	 */
	onKeyUp(noteNumber:number, velocity:number){
		const command:AudioCommand = new AudioCommand()
		command.number = noteNumber
		command.type = NOTE_OFF
		command.velocity = velocity
		command.from = ONSCREEN_KEYBOARD_INPUT_ID
		command.startAt = this.now
		command.time = this.now
		this.dispatch( command )
	}
}