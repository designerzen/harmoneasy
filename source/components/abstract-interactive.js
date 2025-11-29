export const DEFAULT_MOUSE_ID = 1

export default class AbstractInteractive{

    activeId = new Map()
    activeNotes = new Map()
    activeElement = new Map()

    glide = false

    #rollingIndex = 0
    #maxTouchEvents = 10
    #mouseDown = false
    
    constructor( pitchBend=true ){
        this.glide = pitchBend
    }

    get isMouseDown(){
        return this.#mouseDown
    }

    get isTouching(){
        return this.activeNotes.size > 0
    }

    /**
     * 
     * @param {Number} maxTouches 
     * @returns 
     */
    getNextAvailableIndex( maxTouches ){
        let id = (DEFAULT_MOUSE_ID + this.#rollingIndex) % maxTouches
        // loop through all digits starting from default to find which is "free"
        for (let i=0; i < maxTouches; i++)
        {
            id = (id + i) % maxTouches
            if ( this.activeId.has( id ) ){
                // continue lopping
                continue
            }else{
                // escape with this none-active one
                return id
            }
        }
        // not good - all instruments are engaged!
        return id
    }

    getIdFromEvent( event ){

        // if this element already has handled an interaction
        // resuse the id previously cached
        if ( this.activeElement.has( event.target ) )
        {
            return this.activeElement.get( event.target )
        }

        // update index immediately!
        // switch (event.pointerType) {
        //     case "mouse":
                
        // }
        switch (event.pointerType) {

            case "touch":
                // each touch id is different
                return event.pointerId

            default:
            //case "mouse":
            //case "pen":
                return this.getNextAvailableIndex( this.#maxTouchEvents )
                // console.log(`pointerType ${ev.pointerType} is not supported`);
        }
    }

	/**
	 * Add interactivity to the keyboard and wire these
	 * to the noteOn and noteOff functions provided
	 * @param {Function} noteOn - method to call to play a note
	 * @param {Function} noteOff - method to call to stop the playing note
	 * @param {Boolean} passive - use passive listeners 
	 */
	addInteractivity( buttonElements, noteOn, noteOff, passive=true ){
		
		if(!buttonElements)
		{
			throw Error("No keys provided to add interactivity to")
		}

		const controller = new AbortController()
	
		buttonElements.forEach( (button, i) => {
		
            // can come from a touch a mouse click or a keyboard enter press
			const onInteractionStarting = (event ) => {

				// Keypresses other than Enter and Space should not trigger a command
				if (
					event instanceof KeyboardEvent &&
					event.key !== "Enter" &&
					event.key !== " "
				) {
					return
				}

				if (!passive && event.preventDefault)
				{
					event.preventDefault()
				}

                // roll around of 
                this.#rollingIndex = (this.#rollingIndex + 1 ) % this.#maxTouchEvents 

                switch (event.pointerType) {
                    case "mouse":
                        this.#mouseDown = true
                }

                const pressure = event.pressure ?? event.webkitForce ?? 1
                const note = this.getNoteFromKey(button)
                // TODO: Check if already interacting with this element
                const id = this.getIdFromEvent( event )
              
              
		
				// noteName = button.getAttribute("data-note")
				// convert name into MIDI note number
				// const note = convertNoteNameToMIDINoteNumber(noteName)
				
				const starting = noteOn(note, pressure, id) 
                
                this.activeNotes.set( id, note )
                this.activeId.set( id, true )
                this.activeElement.set( event.target, id )

                // console.log( id, event, starting, "START interaction",  this.#rollingIndex ) 
               
				document.addEventListener("pointerleave", onInterationComplete, {signal: controller.signal, passive })
				document.addEventListener("pointerup", onInterationComplete, {signal: controller.signal, passive })
				document.addEventListener("pointercancel", onInterationComplete, {signal: controller.signal, passive })
                document.addEventListener("visibilitychange", onInterationComplete,  {signal: controller.signal, passive })
			}
		
            /**
             * 
             * @param {Event} event 
             * @returns 
             */
			const onInterationComplete = (event) => {

				// Keypresses other than Enter and Space should not trigger a command
				if (
					event instanceof KeyboardEvent &&
					event.key !== "Enter" &&
					event.key !== " "
				) {
					return
				}

				if (!passive && event.preventDefault)
				{
					event.preventDefault()
				}

                if (event.pointerType === "mouse" || event.type === "pointerup" || event.type === "pointercancel")
                {
                    this.#mouseDown = false
                }
             
				document.removeEventListener("pointerleave", onInterationComplete)
				document.removeEventListener("pointerup", onInterationComplete)
				document.removeEventListener("pointercancel", onInterationComplete)
                document.removeEventListener("visibilitychange", onInterationComplete )

                const id = this.getIdFromEvent( event )
              
                const currentlyPlayingNote = this.activeNotes.get( id )
               
                if (currentlyPlayingNote)
                {
                    noteOff(currentlyPlayingNote, 1, id)
                }
				   
                // console.log(id, "STOP interaction" ) 
               
                this.activeNotes.delete( id )
                this.activeId.delete( id )
                this.activeElement.delete( event.target )

                // check for amount of touches...
                // const touches = event.changedTouches
				// this.isTouching = this.activeNotes.size > 0
				// document.querySelector(`.indicator[data-note="${noteName}"]`)?.classList?.toggle("active", false)
			}
           
            button.addEventListener("pointerdown", onInteractionStarting, {signal: controller.signal,passive})
			
            // User leaves element - turns off note but updates id
			button.addEventListener("pointerleave", event => {
               
				if (!passive && event.preventDefault)
				{
					event.preventDefault()
				}
        
                // Stop existing note playback
                const id = this.getIdFromEvent( event )
                const currentlyPlayingNote = this.activeNotes.get( id )
				
                // console.info(id, event.pointerType, "pointerleave", {event, id, currentlyPlayingNote} )
                
                if (currentlyPlayingNote)
                {
                    noteOff(currentlyPlayingNote,1,id)   
                    this.activeNotes.delete( id )
                    this.activeId.set( id, false )
                    this.activeElement.delete( event.target )
                    
                    // this will break it here!
                    // this.#rollingIndex++
               }
				
			}, {signal: controller.signal, passive })

			// if the user has finger down but they change keys...
			button.addEventListener("pointerenter", event => {
               
               if (!passive && event.preventDefault)
				{
					event.preventDefault()
				}

                if (this.#mouseDown)
                {
                    this.#rollingIndex = (this.#rollingIndex + 1 ) % this.#maxTouchEvents 
                }
             
                // this id will always be inactive due to fetching ids from targets
                const id = this.getIdFromEvent( event )
                const isActive = this.activeId.has( id )
                
                // console.info( id, event.pointerType , "pointerenter",{ event, id, isActive})
				
                // if we already playing, we change the note
				if (isActive || this.#mouseDown)
				{	
					const requestedNote = this.getNoteFromKey(button)
					// document.querySelector(`.indicator[data-note="${previousNote}"]`)?.classList?.toggle("active", false)
					// document.querySelector(`.indicator[data-note="${noteName}"]`)?.classList?.toggle("active", true)
                    if (!this.glide)
                    {
                    	// TODO: pitch bend!
                    }

					// console.info("REQUEST CHANGE", {note, noteName,GENERAL_MIDI_INSTRUMENTS})
                    // const currentlyPlayingNote = this.activeNotes.get( id )
                    // if (currentlyPlayingNote)
                    // {
                    //     noteOff(currentlyPlayingNote, 1, id)
                    // } 
					noteOn(requestedNote, 1, id)

                    // overwrite the pointer
                    this.activeNotes.set( id, requestedNote )
                    this.activeId.set( id, true )
                    this.activeElement.set( event.target, id )
                }
                
			}, {signal: controller.signal, passive})
		    
		})
		return ()=>{
			controller.abort()
		}
	}
}