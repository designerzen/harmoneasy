import { formatTimeStampFromSeconds } from "../libs/audiobus/timing/timer"
import NoteVisualiser from './note-visualiser.js'
import SVGKeyboard from './keyboard-svg.js'

const DOM_ID_MIDI_INPUTS = "midi-input-commands"
const DOM_ID_MIDI_OUTPUTS = "midi-output-commands"
const DOM_ID_MIDI_DEVICES = "midi-devices"
const DOM_ID_CLOCK = "clock"
const DOM_ID_SELECTOR_SCALE = "scale-selector"
const DOM_ID_ROOT_SELECTOR = "root-selector"
const DOM_ID_SELECTOR_MIDI_CHANNEL = "midi-channel-selector"
const DOM_ID_RANGE_TEMPO = "tempo"
const DOM_ID_BPM = "bpm"
const DOM_ID_BUTTON_CONNECT_BLUETOOTH = "btn-connect-to-ble"
const DOM_ID_BUTTON_TOGGLE_WEBMIDI = "btn-toggle-webmidi"

const DOM_ID_DIALOG_ERROR = "error-dialog"

export default class UI{

    constructor( keyboardNotes, onNoteOn, onNoteOff ){
        this.devices = document.getElementById(DOM_ID_MIDI_DEVICES)
        
        this.inputs = document.getElementById(DOM_ID_MIDI_INPUTS)
        this.outputs = document.getElementById(DOM_ID_MIDI_OUTPUTS)
        
        this.elementClock = document.getElementById(DOM_ID_CLOCK)
        this.elementScaleSelector = document.getElementById(DOM_ID_SELECTOR_SCALE)
        this.elementRootSelector = document.getElementById(DOM_ID_ROOT_SELECTOR)
        this.elementMIDIChannelSelector = document.getElementById(DOM_ID_SELECTOR_MIDI_CHANNEL)
        this.elementTempo = document.getElementById(DOM_ID_RANGE_TEMPO)
        this.elementBPM = document.getElementById(DOM_ID_BPM)
        
        this.elementButtonBluetoothConnect = document.getElementById(DOM_ID_BUTTON_CONNECT_BLUETOOTH)
    
        this.elementButtonWebMIDI = document.getElementById(DOM_ID_BUTTON_TOGGLE_WEBMIDI)
        this.elementBLEManualFields = document.getElementById('ble-manual-send-fieldset')
        this.elementBLEManualInput = document.getElementById('ble-manual-input')
        this.elementBLEManualSendButton = document.getElementById('btn-send-ble-manual')
        this.elementBLEManualSendButton = document.getElementById('btn-send-ble-manual')
     
        this.elementErrorDialog = document.getElementById(DOM_ID_DIALOG_ERROR )
        
        this.wallpaperCanvas = document.getElementById("wallpaper")
        this.noteVisualiser = new NoteVisualiser( keyboardNotes, this.wallpaperCanvas, false, 0 ) // ALL_KEYBOARD_NOTES
        // wallpaperCanvas.addEventListener( "dblclick", e => scale === SCALES[ (SCALES.indexOf(scale) + 1) % SCALES.length] )

        this.keyboard = new SVGKeyboard( keyboardNotes, onNoteOn, onNoteOff )
        this.keyboardElement = document.body.appendChild( this.keyboard.asElement )
    }


    /**
     * 
     * @param {MIDIDevice} device 
     * @param {Number} index 
     */
    addDevice( device, index ){
        this.devices.innerHTML += `MIDI Device #${index} : ${device.manufacturer} ${device.name} <br>`
    }

    /**
     * 
     * @param {MIDIDevice} device 
     * @param {Number} index 
     */
    addInput( device, index ){
        this.inputs.innerHTML += `MIDI Device #${index} : ${device.manufacturer} ${device.name} <br>`
    }

    /**
     * setTempo(tempo)
     * @param {Number} tempo 
     */
    setTempo(tempo){
        this.elementTempo.value = tempo
        this.elementBPM.textContent = tempo
    }

    setPlaying(isPlaying){
        this.elementTempo.classList.toggle("playing", isPlaying)
    }

    whenBluetoothDeviceRequested(callback){
        this.elementButtonBluetoothConnect.addEventListener("click", e=>{
            callback && callback() 
        })
    }

    setBluetoothButtonText(text = "Connect Bluetooth"){
        this.elementButtonBluetoothConnect.textContent = text
    }

    setWebMIDIButtonText(text = "Enable WebMIDI"){
        if (this.elementButtonWebMIDI) this.elementButtonWebMIDI.textContent = text
    }

    whenWebMIDIToggled(callback){
        if (!this.elementButtonWebMIDI) return
        this.elementButtonWebMIDI.addEventListener('click', e => {
            callback && callback()
        })
    }

    /**
     * Register a callback that will be invoked when the user requests a manual BLE send.
     * The callback receives the raw input string (commas allowed) so the caller can parse it
     * into a Uint8Array or other form for sending.
     * @param {Function} callback (value: string) => void
     */
    whenUserRequestsManualBLECodes(callback){
        if (!this.elementBLEManualSendButton || !this.elementBLEManualInput) return
        const doSend = () => {
            const raw = String(this.elementBLEManualInput.value || '').trim()
            callback && callback(raw)
        }
        this.elementBLEManualSendButton.addEventListener('click', e => doSend())
        // allow Enter key in the input to trigger send
        this.elementBLEManualInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); doSend() }
        })
    }

    /**
     * Toggle visibility of the manual BLE input and send button.
     * @param {boolean} visible
     */
    setBLEManualInputVisible(visible){
        if (this.elementBLEManualFields)
        { 
            this.elementBLEManualFields.hidden = !visible
        }
    }

    /**
     * Convenience method to reveal the manual BLE input once a Bluetooth connection is established.
     */
    showBLEManualInputOnBluetoothConnected(){
        this.setBLEManualInputVisible(true)
    }

    whenTempoChangesRun(callback){
        this.elementTempo.addEventListener("input", e=>{
            const tempo  = this.elementTempo.value
            callback && callback(tempo) 
            this.elementBPM.textContent = tempo
        })
    }
    
    /**
     * 
     * @param {Function} callback 
     */
    // whenNewScaleIsSelected(callback){
    //     this.elementScaleSelector.addEventListener("change", e=>callback(this.elementScaleSelector.value, this.elementScaleSelector) )
    // }

    // whenNewRootIsSelected(callback){
    //     this.elementRootSelector.addEventListener("change", e=>callback(parseInt(this.elementRootSelector.value, 10), this.elementRootSelector) )
    // }

    /**
     * Register a callback when MIDI channel selection changes.
     * @param {Function} callback (channel: number) => void
     */
    whenMIDIChannelSelected(callback){
        if (!this.elementMIDIChannelSelector) return
        this.elementMIDIChannelSelector.addEventListener("change", e => {
            const channel = Number(this.elementMIDIChannelSelector.value)
            callback && callback(channel)
        })
    }

    /**
     * 
     * @param {MIDIDevice} device 
     * @param {Number} index 
     */
    addOutput( device, index ){
        this.outputs.innerHTML += `MIDI Device #${index} : ${device.manufacturer} ${device.name} <br>`
    }

    addCommand(command){
        this.inputs.innerHTML = `MIDI Command START #${command} <br>` + this.inputs.innerHTML
    }

    removeCommand(command){
        this.inputs.innerHTML = `MIDI Command STOP #${command} <br>`+ this.inputs.innerHTML
    }

    updateClock( values ){
         const { 
            divisionsElapsed,
            bar, bars, 
            barsElapsed, timePassed, 
            elapsed, expected, drift, level, intervals, lag
        } = values

        this.elementClock.textContent = `${String(bar).padStart(2, '0')}:${bars}:${String(barsElapsed).padStart(3, '0')} [${String(divisionsElapsed).padStart(2, '0')}] ${formatTimeStampFromSeconds(elapsed)} seconds`
        // this.elementClock.innerHTML = `${String(bar).padStart(2, '0')}:${bars}:${String(barsElapsed).padStart(3, '0')} [${String(divisionsElapsed).padStart(2, '0')}] ${formatTimeStampFromSeconds(elapsed)} seconds`
        // this.elementClock.innerHTML = `${bar}:${bars}:${barsElapsed} [${divisionsElapsed}] ${intervals}, ${elapsed.toFixed(2)} seconds`
    }

    /**
     * Show Note On
     * @param {*} note 
     */
    noteOn(note) {
        this.noteVisualiser.noteOn( note )
        this.keyboard.setKeyAsActive( note )
        this.addCommand("NoteOn #" + note.number )
    }

    /**
     * Show Note Off
     * @param {*} note 
     */
    noteOff(note) {
        this.noteVisualiser.noteOff( note )
        this.keyboard.setKeyAsInactive( note )
        this.removeCommand("NoteOff #" + note.number )
    }

    /**
     * Displays an error on the screen
     * @param {String} errorMessage 
     * @param {Boolean} fatal - does this break the app?
     */
    showError( errorMessage, solution="", fatal=false )
    {
        this.inputs.innerHTML = errorMessage
        this.inputs.classList.toggle("error", true)

        const elementIssue = this.elementErrorDialog.querySelector("#error-message")
        const elementSolution = this.elementErrorDialog.querySelector("#error-solution")
        
        elementIssue.innerHTML = errorMessage
        if (solution && solution.length > 0)
        {
            elementSolution.innerHTML = solution
            elementSolution.hidden = false
        }else{
            elementSolution.hidden = true
        }
      
        this.elementErrorDialog.open = true
        console.error(errorMessage)
    }

    /**
     * Display BLE device info and capabilities
     * @param {BluetoothDevice} device
     * @param {Object} capabilities { services: Array }
     */
    addBluetoothDevice( device, capabilities ){
        let html = `<strong>BLE Device: ${device.name || 'Unknown'}</strong><br>`
        html += `UUID: ${device.id}<br>`
        if (capabilities && capabilities.services) {
            html += `<details><summary>Services & Characteristics (${capabilities.services.length})</summary>`
            capabilities.services.forEach(svc => {
                html += `<div style="margin-left: 1em;">`
                html += `<strong>Service:</strong> ${svc.uuid}<br>`
                if (svc.characteristics) {
                    svc.characteristics.forEach(ch => {
                        const props = ch.properties ? Object.keys(ch.properties).filter(k => ch.properties[k]) : []
                        html += `<div style="margin-left: 1em;"><code>${ch.uuid}</code> [${props.join(', ')}]</div>`
                    })
                }
                html += `</div>`
            })
            html += `</details>`
        }
        html += `<hr>`
        this.devices.innerHTML += html
    }

    /**
     * Show error/status message in the devices panel
     * @param {String} message
     */
    showBluetoothStatus( message ){
        this.elementButtonBluetoothConnect.textContent = message
    }

    onDoubleClick( callback){
        this.wallpaperCanvas.addEventListener( "dblclick", e => callback && callback(e) )   
    }
}