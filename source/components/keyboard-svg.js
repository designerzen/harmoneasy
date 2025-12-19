import AbstractInteractive from "./abstract-interactive"

/**
 * Get the note name (in scientific notation) of the given midi number
 *
 * It uses MIDI's [Tuning Standard](https://en.wikipedia.org/wiki/MIDI_Tuning_Standard)
 * where A4 is 69
 *
 * This method doesn't take into account diatonic spelling. Always the same
 * pitch class is given for the same midi number.

 * @param {Integer} midi - the midi number
 * @return {String} the pitch
 */
export const convertNoteNameToMIDINoteNumber = name => NOTE_NAME_MAP[name]

const DEFAULT_TITLE = "Piano Keyboard with 12 keys"

export default class SVGKeyboard extends AbstractInteractive{

	static uniqueID = 0

	isTouching = false
	keyElements = []

	htmlElement
	titleElement

	firstNoteNumber = 0

    notes = []

	get svg(){
		return this.svgString
	}

	get asElement(){
		return this.htmlElement
	}

	set title( value ){
		this.titleElement.textContent = value
	}

	constructor( notes, noteOn, noteOff ){
		super()
        const unique = `keyboard-${SVGKeyboard.uniqueID++}`
		this.titleID = `${unique}-title`
		this.descriptionID = `${unique}-desc`
		const {svg, whiteKeyElements, blackKeyElements} = this.createKeyboard(notes)
		this.htmlElement = document.createElement("div")
		this.htmlElement.className = "piano"
		this.htmlElement.setAttribute( "data-piano", true )
		this.htmlElement.innerHTML = svg
		this.titleElement = this.htmlElement.querySelector("title")
		this.keyElements = Array.from(this.htmlElement.querySelectorAll(".piano-key"))
       
        this.keyMap = new Map()
        this.keyElements.forEach( (value, index) => {
            // const key = this.htmlElement.querySelector('[data-number="'+noteNumber+'"]')
            this.keyMap.set( parseInt(value.dataset.number), value )
        })
        
        // console.error( this.keyElements  )
        // console.error( this.keyMap )

      	this.firstNoteNumber = notes[0].noteNumber
		this.svgString = svg
		this.addInteractivity( this.keyElements, noteOn, noteOff)
	}

    getNoteFromKey( button){
        const noteNumber = parseInt( button.getAttribute("data-number") )
        const note = this.notes[noteNumber - this.firstNoteNumber]
        // console.info("noteNumber", noteNumber, note, this.notes )
        return note
    }

	createKeyName( key, x, y, width=23, height=120 ){
		const textYPosition = y + height
		return `<text x="${x}" y="${textYPosition}" class="piano-key-name">${key.noteName}</text>`
	}

	createBlackKey( key, x, y, r=1.5, width=13, height=80 ){
		return `<rect 
					x="${x}" 
					y="${y}" 
					rx="${r}" 
					role="button"
					tabindex="0"
					oncontextmenu="return false;"
					class="piano-key piano-key-black" 
					width="${width}" height="${height}" 
					title="${key.noteName}" 
					aria-label="${key.noteName}"
                    data-key="${key.noteKey}" 
					data-note="${key.noteName}" 
					data-number="${key.noteNumber}" 
					data-frequency="${key.frequency}"
					data-key="${key.noteKey}"
					data-octave="${key.octave}"
				>
				</rect>`
	}
	
	createWhiteKey( key, x, y, r=1.5, width=23, height=120 ){
		return `<rect 
					x="${x}" 
					y="${y}" 
					rx="${r}" 
					role="button"
					tabindex="0"
					oncontextmenu="return false;"
					class="piano-key piano-key-white" 
					width="${width}" height="${height}" 
					title="${key.noteName}" 
					aria-label="${key.noteName}"
					data-key="${key.noteKey}" 
					data-note="${key.noteName}" 
					data-number="${key.noteNumber}" 
					data-frequency="${key.frequency}"
					data-octave="${key.octave}"
				>
				</rect>`
	}
	
	/**
	 * 
	 * @param {Object} key 
	 * @param {Number} x 
	 * @param {Number} y 
	 * @param {Number} r 
	 * @returns 
	 */
	createIndicator( key, x, y, r=5 ){
		return `<circle 
					cx="${x}" 
					cy="${y}" 
					r="${r}" 
					class="piano-note-indicator" 
					data-note="${key.noteName}" 
					data-number="${key.noteNumber}" 
					data-frequency="${key.frequency}"
					data-octave="${key.octave}"
				>
				</circle>`
	}

	/**
	 * Create an SVG keyboard
	 * @param {Array} keys 
	 * @param {Number} blackKeyWidth 
	 * @param {Number} whiteKeyWidth 
	 * @returns {SVG}
	 */
	createKeyboard( keys, blackKeyWidth=13, whiteKeyWidth=23, indicatorWidth=8, blackKeyScale=0.5, whiteKeyHeight=140, x=0, y=20 ){

		const curvedRadius = 6
		const halfBlackKeyWidth = blackKeyWidth / 2
		const halfIndicatorWidth = indicatorWidth / 2
		const indicatorRadius = halfIndicatorWidth
		const spaceBetweenIndicators = whiteKeyWidth - indicatorWidth
		const blackKeyHeight = whiteKeyHeight * blackKeyScale
		const totalHeight = whiteKeyHeight
		
		// rescaled by SVG - just for proportion
		let totalWidth = 0 // 1197.8
		
		// Keys as strings
		const whiteKeyElements = []
		const blackKeyElements = []
		
		const keyElements = keys.map( (key,index)=>{
			
            // FIXME: 
			const isBlack = key.accidental ?? false
			
			// if the key is a black key, we move back
			x -= isBlack ? halfBlackKeyWidth : 0
		
			const keyElement = isBlack ?
							this.createBlackKey(key, x, y, curvedRadius, blackKeyWidth, blackKeyHeight) :
							this.createWhiteKey(key, x, y, curvedRadius, whiteKeyWidth, whiteKeyHeight )
			
			const keyQuantity = isBlack ?
			 				blackKeyElements.push( keyElement ) :
			 				whiteKeyElements.push( keyElement )
			
		
			this.createKeyName( key, x, y, blackKeyWidth, blackKeyHeight )
	
			x += isBlack ? halfBlackKeyWidth : whiteKeyWidth
			// x += isBlack ? -halfBlackKeyWidth  : whiteKeyWidth
			
			// only white keys affect total width
			totalWidth += isBlack ? 0 : whiteKeyWidth

            this.notes.push( key )

			return keyElement
		})

		// Indicators
		x = 0 // spaceBetweenIndicators / 2
		y = 0

		const indicatorElements = keys.map( (key,index)=>{
			const indicator = this.createIndicator(key, x, y, indicatorRadius )
			x += spaceBetweenIndicators
			return indicator
		})

		const keyboard =   `<g class="piano-key-notes piano-keys-white">${whiteKeyElements.join("")}</g>
							<g class="piano-key-notes piano-keys-black">${blackKeyElements.join("")}</g>`

		const indicators = `<g class="piano-key-indicators">${indicatorElements.join("")}</g>`
		
		const svg = `<svg 
					xmlns="http://www.w3.org/2000/svg" 
					class="piano-keys" 
					viewBox="0 0 ${totalWidth} ${totalHeight}" 
					aria-labelledby="${this.titleID} ${this.descriptionID}"
					draggable="false">
					<title id="${this.titleID}">Piano Keyboard with ${keys.length} keys</title>
					<desc id="${this.descriptionID}">Interactive Piano Keyboard with ${keys.length} keys</desc>
					${keyboard}
					${indicators}
				</svg>`

		return {svg, keyElements, whiteKeyElements, blackKeyElements}
	}

	/**
	 * 
	 * @param {Number} noteNumber 
	 */
	setKeyAsActive( noteModel ){
		const noteNumber = noteModel.noteNumber
        const key = this.keyMap.get( noteNumber ) ?? this.htmlElement.querySelector('[data-number="'+noteNumber+'"]')
		// const key = this.keyElements[noteNumber - this.firstNoteNumber]
		if (key)
		{
			key.classList.toggle("active", true)
			//this.title = noteModel.toString()
		}else{
			// console.warn("Key "+noteNumber+" not found")
		}
	}

	/**
	 * 
	 * @param {Number} noteNumber 
	 */
	setKeyAsInactive( noteModel ){
		const noteNumber = noteModel.noteNumber
        const key = this.keyMap.get( noteNumber ) ?? this.htmlElement.querySelector('[data-number="'+noteNumber+'"]')
		// const key = this.keyElements[noteNumber - this.firstNoteNumber]
		if (key)
		{
			key.classList.toggle("active", false)
		}else{
			//console.warn("Key "+noteNumber+" outside range")
		}
	}
}