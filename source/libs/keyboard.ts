import * as Commands from '../commands.ts'

/**
 *  Add Keyboard listeners and tie in commands
 */
export const addKeyboardDownEvents = ( callback:Function ) => {
	
	// For typing longer numbers
	let numberSequence = ""
	let octaveOffset = 41

	const midiNoteSequence = [
		"q","2","w","3","e","r","5","t","6","y","7","u","i","9","o","0","p",
		"[","]","\\",
		"a","z","s","x","d","c","f","v","g","b","h","n","j","m","k",",","l",".",";","/","'"
	]

	const keysPressed = new Map()
	const keyboardMap = new Map()

	midiNoteSequence.forEach( (midiNote, index) => keyboardMap.set( midiNote, index+octaveOffset ) )

	window.addEventListener('keydown', async (event)=>{
		const isNumber = !isNaN( parseInt(event.key) )
		const focussedElement = document.activeElement

		// Allow Tab to continue to perform its default function
		if ( event.key !== 'Tab' ){
			event.preventDefault()
		}

		if ( keysPressed.has(event.key) )
		{
			// already pressed so ignore
			return
		}

		// Contextual hotkeys - if something is focussed then different keys!
		if (focussedElement && focussedElement !== document.documentElement )
		{
			// not body!
			switch(focussedElement.nodeName)
			{
				case "BUTTON":
				
					break

				// 
				case "DIALOG":

					break
				
			}

			// we should quit here?
		}

		let command = undefined
		let value = -1

		if (keyboardMap.has(event.key))
		{
			const noteNumber = keyboardMap.get(event.key)
			keysPressed.set(event.key, noteNumber)
			console.log("Key down", Commands.NOTE_ON, event.key, noteNumber )
			callback( Commands.NOTE_ON, event.key, noteNumber )
			return
		}
		
		switch(event.key)
		{
			case 'CapsLock':
				event.preventDefault()
				break

			case 'Escape':
			case 'Del':
			case 'Delete':
				command = Commands.PLAYBACK_STOP
				break

			case 'Enter':
				command = Commands.PLAYBACK_TOGGLE
				break;
			case 'Space':
				command = Commands.TEMPO_TAP
				break;
			case 'QuestionMark':
				event.preventDefault();
				break;
			case '?':
				event.preventDefault();
				break;
			case 'ArrowLeft':
				command = Commands.PITCH_BEND
				value = 0.2
				break;
			case 'ArrowRight':
				command = Commands.PITCH_BEND
				value = -0.2
				break;
			case 'ArrowUp':
				command = Commands.TEMPO_INCREASE
				break;
			case 'ArrowDown':
				command = Commands.TEMPO_DECREASE
				break;
			case ',':
				event.preventDefault();
				break;
			case '.':
				event.preventDefault();
				break;
			case 'a':
				event.preventDefault();
				break;
			case 'b':
				event.preventDefault();
				break;
			case 'c':
				event.preventDefault();
				break;
			case 'd':
				event.preventDefault();
				break;
			case 'e':
				event.preventDefault();
				break;
			case 'f':
				event.preventDefault();
				break;
			case 'g':
				event.preventDefault();
				break;
			case 'h':
				event.preventDefault();
				break;
			case 'i':
				event.preventDefault();
				break;
			case 'j':
				event.preventDefault();
				break;
			case 'k':
				event.preventDefault();
				break;
			case 'l':
				event.preventDefault();
				break;
			case 'm':
				event.preventDefault();
				break;
			case 'n':
				event.preventDefault();
				break;
			case 'o':
				event.preventDefault();
				break;
			case 'p':
				event.preventDefault();
				break;
			case 'q':
				event.preventDefault();
				break;
			case 'r':
				event.preventDefault();
				break;
			case 's':
				event.preventDefault();
				break;
			case 't':
				event.preventDefault();
				break;
			case 'u':
				event.preventDefault();
				break;

			case 'v':
				event.preventDefault()
				break

			case 'w':
				event.preventDefault()
				break
		
			case 'x':
				event.preventDefault()
				break

			case 'y':
				event.preventDefault()
				break
		
			case 'z':
				event.preventDefault()
				break
				
			case "F1":
				event.preventDefault()
				break

			case "F2":
				event.preventDefault()
				break

			case "F3":
				event.preventDefault()
				break

			case "F4":
				event.preventDefault()
				break
		
			// Select Players only
			case "F5":
				event.preventDefault()
				break

			case "F6":
				event.preventDefault()
				break

			case "F7":
				event.preventDefault()
				break

			case "F8":
				event.preventDefault()
				break

		
			// Media Hotkeys

			// Launch Media
			case "LaunchMediaPlayer":
				event.preventDefault()
				break

			// Previous Track
			case "MediaTrackPrevious":
				event.preventDefault()
				break

			// Play / Pause Percussion
			case "MediaPlayPause":
				event.preventDefault()
				break

			// Next Track
			case "MediaTrackNext":
				event.preventDefault()
				break
				
			case "F9":
				event.preventDefault()
				break
		
			case "F10":
				event.preventDefault()
				break

			// Play / Pause Percussion
			case "F11":
				event.preventDefault()
				break

			// Next Track
			case "F12":
				event.preventDefault()
				break

			case "F13":
				event.preventDefault()
				break

			case "F14":
				event.preventDefault()
				break

			case "F15":
				event.preventDefault()
				break

			case "F16":
				event.preventDefault()
				break

			case "F17":
				event.preventDefault()
				break

			case "F18":
				event.preventDefault()
				break

			case "F19":
				event.preventDefault()
				break

			// don't hijack tab you numpty!
			// FILTER
			case 'Tab':
				break

			default:
				// check if it is numerical...
				// or if it is a media key?
				if (!isNumber)
				{
					// loadRandomInstrument()
					// speak("Loading random instruments",true)	
				}
				console.log("Key pressed", {event,isNumber} )
		}

		// Check to see if it is a number
		if (isNumber)
		{
			numberSequence += event.key
			// now check to see if it is 3 numbers long
			if (numberSequence.length === 3)
			{
				// reset
				numberSequence = ''
			}

		}else{

			numberSequence = ''
		}

		keysPressed.set( event.key, value )
		callback( command, event.key, value )
		// console.log("key", ui, event)
	})

	// depress notes held
	window.addEventListener('keyup', async (event)=>{

		if ( event.key !== 'Tab' ){
			event.preventDefault()
		}

		if (keyboardMap.has(event.key))
		{
			// note was pressed, so send note off
			const noteNumber = keysPressed.get(event.key)
			console.log("Key up", Commands.NOTE_OFF, event.key, noteNumber )
			keysPressed.delete(event.key)
			callback( Commands.NOTE_OFF, event.key, noteNumber )
		}else{
			console.log("Key up but no key down found", event.key, keyboardMap )
		}
	})
}
