
import AbstractInput from "./abstract-input"
import AudioCommand from "../audio-command"
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from "../../../commands"

export const ONSCREEN_KEYBOARD_INPUT_ID = "OnscreenKeyboard"

export default class InputOnScreenKeyboard extends AbstractInput implements IInput{
	
	get name():string {
		return ONSCREEN_KEYBOARD_INPUT_ID
	}

	constructor( options={} ) { 
		super(options)
	}

	onKeyDown(){

	}

	onKeyUp(){

	}
}