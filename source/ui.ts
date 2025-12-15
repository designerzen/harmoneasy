import { formatTimeStampFromSeconds } from "./libs/audiobus/timing/timer.ts"
import { SongVisualiser } from './components/song-visualiser.ts'
import { SongVisualiserUI } from './components/song-visualiser-ui.ts'
import SVGKeyboard from './components/keyboard-svg.js'
import NoteVisualiser from './components/note-visualiser.js'
import type { IAudioCommand } from "./libs/audiobus/audio-command-interface.ts"
import NoteModel from "./libs/audiobus/note-model.ts"

const DOM_ID_MIDI_INPUTS = "midi-input-commands"
const DOM_ID_MIDI_OUTPUTS = "midi-output-commands"
const DOM_ID_MIDI_DEVICES = "midi-devices"
const DOM_ID_CLOCK = "clock"
const DOM_ID_SELECTOR_SCALE = "scale-selector"
const DOM_ID_ROOT_SELECTOR = "root-selector"
const DOM_ID_SELECTOR_MIDI_CHANNEL = "midi-channel-selector"
const DOM_ID_RANGE_TEMPO = "tempo"
const DOM_ID_BPM = "bpm"
const DOM_ID_RANGE_VOLUME = "volume"
const DOM_ID_VOLUME_OUTPUT = "volume-output"
const DOM_ID_BUTTON_CONNECT_BLUETOOTH = "btn-connect-to-ble"
const DOM_ID_BUTTON_TOGGLE_WEBMIDI = "btn-toggle-webmidi"

const DOM_ID_BUTTON_IMPORT_MIDI_FILE = "btn-midi-import"
const DOM_ID_BUTTON_EXPORT_MIDI_FILE = "btn-midi-export"
const DOM_ID_BUTTON_EXPORT_MIDI_MARKDOWN = "btn-midi-markdown-export"
const DOM_ID_BUTTON_EXPORT_MUSICXML = "btn-musicxml-export"
const DOM_ID_BUTTON_EXPORT_VEXFLOW = "btn-vexflow-export"
const DOM_ID_BUTTON_EXPORT_AUDIOTOOL = "btn-audiotool-export"
const DOM_ID_BUTTON_EXPORT_OPENDAW = "btn-opendaw-export"
const DOM_ID_BUTTON_EXPORT_DAWPROJECT = "btn-dawproject-export"

const DOM_ID_BUTTON_KILL_SWITCH = "btn-kill-switch"
const DOM_ID_BUTTON_RESET = "btn-reset"
const DOM_ID_BLE_MANUAL_FIELDSET = "ble-manual-send-fieldset"
const DOM_ID_BLE_MANUAL_INPUT = "ble-manual-input"
const DOM_ID_BUTTON_SEND_BLE_MANUAL = "btn-send-ble-manual"
const DOM_ID_BUTTON_RANDOM_TIMBRE = "btn-random-timbre"
const DOM_ID_EXPORT_OVERLAY = "export-overlay"

const DOM_ID_NOTE_VISUALISER_CANVAS = "note-visualiser"

const DOM_ID_DIALOG_ERROR = "error-dialog"
const DOM_ID_DIALOG_INFO = "info-dialog"

export default class UI{

    clockAnimationFrame = -1
    devices: HTMLElement | null
    inputs: HTMLElement | null
    outputs: HTMLElement | null
    elementClock: HTMLElement | null
    elementScaleSelector: HTMLElement | null
    elementRootSelector: HTMLElement | null 
    elementMIDIChannelSelector: HTMLElement | null
    elementTempo: HTMLElement | null
    elementBPM: HTMLElement | null
    elementVolume: HTMLElement | null
    elementVolumeOutput: HTMLElement | null
    elementButtonBluetoothConnect: HTMLElement | null
    elementButtonWebMIDI: HTMLElement | null
    elementBLEManualFields: HTMLElement | null
    elementBLEManualInput: HTMLElement | null
    elementBLEManualSendButton: HTMLElement | null
    elementButtonKillSwitch: HTMLElement | null
    elementButtonReset: HTMLElement | null
    elementMidiImportButton: HTMLElement | null
    elementMidiExportButton: HTMLElement | null
    elementMidiMarkdownExportButton: HTMLElement | null
    elementMusicXMLExportButton: HTMLElement | null
    elementVexFlowExportButton: HTMLElement | null
    elementAudioToolExportButton: HTMLElement | null
    elementOpenDAWExportButton: HTMLElement | null
    elementDawProjectExportButton: HTMLElement | null
    elementButtonRandomTimbre: HTMLElement | null
    elementOverlayExport: HTMLElement | null
    elementInfoDialog: HTMLElement | null
    elementErrorDialog: HTMLElement | null
    noteVisualiserCanvas: HTMLElement | null
    noteVisualiser: any
    keyboard: any
    keyboardElement: any
 
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
        this.elementVolume = document.getElementById(DOM_ID_RANGE_VOLUME)
        this.elementVolumeOutput = document.getElementById(DOM_ID_VOLUME_OUTPUT)
        
        this.elementButtonBluetoothConnect = document.getElementById(DOM_ID_BUTTON_CONNECT_BLUETOOTH)
    
        this.elementButtonWebMIDI = document.getElementById(DOM_ID_BUTTON_TOGGLE_WEBMIDI)
        this.elementBLEManualFields = document.getElementById(DOM_ID_BLE_MANUAL_FIELDSET)
        this.elementBLEManualInput = document.getElementById(DOM_ID_BLE_MANUAL_INPUT)
        this.elementBLEManualSendButton = document.getElementById(DOM_ID_BUTTON_SEND_BLE_MANUAL)
        this.elementButtonKillSwitch = document.getElementById(DOM_ID_BUTTON_KILL_SWITCH)
        this.elementButtonReset = document.getElementById(DOM_ID_BUTTON_RESET)
        
        this.elementMidiImportButton = document.getElementById(DOM_ID_BUTTON_IMPORT_MIDI_FILE)
        this.elementMidiExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_MIDI_FILE)
        this.elementMidiMarkdownExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_MIDI_MARKDOWN)
        this.elementMusicXMLExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_MUSICXML)
        this.elementVexFlowExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_VEXFLOW)
        this.elementAudioToolExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_AUDIOTOOL)
        this.elementOpenDAWExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_OPENDAW)
        this.elementDawProjectExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_DAWPROJECT)

        this.elementButtonRandomTimbre = document.getElementById(DOM_ID_BUTTON_RANDOM_TIMBRE)
        
        this.elementOverlayExport = document.getElementById(DOM_ID_EXPORT_OVERLAY)
        this.elementInfoDialog = document.getElementById(DOM_ID_DIALOG_INFO)
        this.elementErrorDialog = document.getElementById(DOM_ID_DIALOG_ERROR)
        
        this.activateSidebar()

        this.noteVisualiserCanvas = document.getElementById(DOM_ID_NOTE_VISUALISER_CANVAS)
        this.noteVisualiser = new NoteVisualiser( keyboardNotes, this.noteVisualiserCanvas, true, 0 ) // ALL_KEYBOARD_NOTES
        // wallpaperCanvas.addEventListener( "dblclick", e => scale === SCALES[ (SCALES.indexOf(scale) + 1) % SCALES.length] )

        this.keyboard = new SVGKeyboard( keyboardNotes, onNoteOn, onNoteOff )
        this.keyboardElement = document.body.appendChild( this.keyboard.asElement )
                
        // Create Note Explorer & visualiser
        // const visualiser = new SongVisualiser()
        // this.wallpaperCanvas.parentNode.appendChild(visualiser)

        this.setupDragAndDrop()
    }

    /**
     * Setup drag and drop file handling for MIDI files
     */
    private setupDragAndDrop(): void {
        const dropZone = document.body

        // Prevent default drag behaviors
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.add('drag-over')
        })

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.remove('drag-over')
        })

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.remove('drag-over')
            
            const files = e.dataTransfer?.files
            if (files && files.length > 0) {
                this.handleMIDIFileDrop(files[0])
            }
        })
    }

    /**
     * Handle dropped MIDI file
     */
    private handleMIDIFileDrop(file: File): void {
        if (!file.type.includes('audio') && !file.name.toLowerCase().endsWith('.mid') && !file.name.toLowerCase().endsWith('.midi')) {
            this.showError('Invalid file type', 'Please drop a MIDI file (.mid or .midi)')
            return
        }

        window.onMIDIFileDropped?.(file)
    }

    /**
     * Register callback for when MIDI file is dropped
     */
    whenMIDIFileDroppedRun(callback: (file: File) => void): void {
        window.onMIDIFileDropped = callback
    }

    /**
     * 
     * @param commands 
     */
    async addSongVisualser(commands:IAudioCommand[]){
        const visualiser = new SongVisualiser()
        this.noteVisualiserCanvas.parentNode.appendChild(visualiser)
        await visualiser.loadCommands(commands)
    }


    activateSidebar(){
          // Sidebar toggle functionality
        const timerBar = document.getElementById('timer-bar')
        const sidebar = document.getElementById('sidebar')
        const sidebarClose = document.getElementById('sidebar-close')

        timerBar.addEventListener('click', () => {
            sidebar.classList.toggle('open')
        })

        sidebarClose.addEventListener('click', () => sidebar.classList.remove('open'))

        // Close sidebar when clicking outside of it
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) &&
                !timerBar.contains(e.target)) {
                sidebar.classList.remove('open')
            }
        })
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

    // Dialogs ----------------------------------------------------------------------
    

    showInfoDialog( title, message ){
        this.elementInfoDialog.querySelector("h5").textContent = title
        this.elementInfoDialog.querySelector("#info-message").innerHTML = message
        this.elementInfoDialog.hidden = false
        this.elementInfoDialog.showModal()
        // this.elementInfoDialog.showModal()
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
      
        this.elementErrorDialog.hidden = false
        this.elementErrorDialog.showModal()
        console.error(errorMessage)
    }


    // Bluetooth --------------------------------------------------------------------

    whenBluetoothDeviceRequestedRun(callback){
        this.elementButtonBluetoothConnect.addEventListener("click", e=>{
            callback && callback() 
        })
    }

    setBluetoothButtonText(text = "Connect Bluetooth"){
        this.elementButtonBluetoothConnect.textContent = text
    }

    /**
     * Show error/status message in the devices panel
     * @param {String} message
     */
    showBluetoothStatus( message ){
        this.elementButtonBluetoothConnect.textContent = message
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
                html += `<div">`
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
        this.devices.innerHTML += html
    }

    /**
     * Register a callback that will be invoked when the user requests a manual BLE send.
     * The callback receives the raw input string (commas allowed) so the caller can parse it
     * into a Uint8Array or other form for sending.
     * @param {Function} callback (value: string) => void
     */
    whenUserRequestsManualBLECodesRun(callback){
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


    setWebMIDIButtonText(text = "Enable WebMIDI"){
        if (this.elementButtonWebMIDI) this.elementButtonWebMIDI.textContent = text
    }

    whenWebMIDIToggledRun(callback){
        if (!this.elementButtonWebMIDI) return
        this.elementButtonWebMIDI.addEventListener('click', e => {
            callback && callback(e)
        })
    }


    // Exporting --------------------------------------------------------------------
    hideExportOverlay(){
        this.elementOverlayExport.hidden = true
    }
    showExportOverlay( text ){
        // this.setExportOverlayText( text 
        this.elementOverlayExport.hidden = false
    }
    setExportOverlayText(text){
        if (text && this.elementOverlayExportText)
        { 
            this.elementOverlayExportText.textContent = text
        }
    }

    // Export Buttons 
    whenAudioToolExportRequestedRun(callback){
        if (!this.elementAudioToolExportButton) return
        this.elementAudioToolExportButton.addEventListener('click', async ( e ) => {
            this.showExportOverlay()
            callback && await callback(e)
            this.hideExportOverlay()
        })
    }
    /**
     * Register callback for when MIDI file import button is clicked
     */
    whenMIDIFileImportRequestedRun(callback: (files: FileList) => void): void {
        if (!this.elementMidiImportButton) return
        
        // Create a hidden file input element
        const fileInput = document.createElement('input')
        fileInput.type = 'file'
        fileInput.accept = '.mid,.midi,audio/midi'
        fileInput.style.display = 'none'
        document.body.appendChild(fileInput)
        
        // When button is clicked, trigger the file input
        this.elementMidiImportButton.addEventListener('click', () => {
            fileInput.click()
        })
        
        // When file is selected, call the callback
        fileInput.addEventListener('change', (e) => {
            const files = (e.target as HTMLInputElement).files
            if (files && files.length > 0) {
                callback && callback(files)
            }
            // Reset the input so the same file can be selected again
            fileInput.value = ''
        })
    }

    whenMIDIFileExportRequestedRun(callback){
        if (!this.elementMidiExportButton) return
        this.elementMidiExportButton.addEventListener('click', async ( e ) => {
            this.showExportOverlay()
            callback && await callback(e)
            this.hideExportOverlay()
        })
    }
    whenMIDIMarkdownExportRequestedRun(callback){
        if (!this.elementMidiMarkdownExportButton) return
        this.elementMidiMarkdownExportButton.addEventListener('click', async ( e ) => {
            callback && await callback(e)
        })
    }
    whenMusicXMLExportRequestedRun(callback){
        if (!this.elementMusicXMLExportButton) return
        this.elementMusicXMLExportButton.addEventListener('click', async ( e ) => {
            this.showExportOverlay()
            callback && await callback(e)
            this.hideExportOverlay()
        })
    }
    whenVexFlowExportRequestedRun(callback){
        if (!this.elementVexFlowExportButton) return
        this.elementVexFlowExportButton.addEventListener('click', async ( e ) => {
            this.showExportOverlay()
            callback && await callback(e)
            this.hideExportOverlay()
        })
    }
    whenOpenDAWExportRequestedRun(callback){
        if (!this.elementOpenDAWExportButton) return
        this.elementOpenDAWExportButton.addEventListener('click', async ( e ) => {
            this.showExportOverlay()
            callback && await callback(e)
            this.hideExportOverlay()
        })
    }
    whenDawProjectExportRequestedRun(callback){
        if (!this.elementDawProjectExportButton) return
        this.elementDawProjectExportButton.addEventListener('click', async ( e ) => {
            this.showExportOverlay()
            callback && await callback(e)
            this.hideExportOverlay()
        })
    }

    whenRandomTimbreRequestedRun(callback){
        this.elementButtonRandomTimbre.addEventListener('click', e => {
            callback && callback(e)
        })
    }

    /**
     * Register a callback for when the kill switch (all notes off) button is clicked
     * @param {Function} callback () => void
     */
    whenKillSwitchRequestedRun(callback){
        if (!this.elementButtonKillSwitch) return
        this.elementButtonKillSwitch.addEventListener('pointerdown', e => {
            callback && callback(e)
        })
    }

    /**
     * Register a callback for when the reset button is clicked
     * Clears all AudioCommands from memory and OPFS storage
     * @param {Function} callback () => void
     */
    whenResetRequestedRun(callback){
        if (!this.elementButtonReset) return
        this.elementButtonReset.addEventListener('click', e => {
            const confirmed = confirm('Are you sure? This will delete all recorded AudioCommands from memory and OPFS storage.')
            if (confirmed) {
                callback && callback(e)
            }
        })
    }

    whenTempoChangesRun(callback){
         this.elementTempo.addEventListener("input", e=>{
             const tempo  = this.elementTempo.value
             callback && callback(tempo) 
             this.elementBPM.textContent = tempo
         })
     }

    whenVolumeChangesRun(callback){
        if (!this.elementVolume) return
        this.elementVolume.addEventListener("input", e=>{
            const volume = this.elementVolume.value
            callback && callback(volume)
            if (this.elementVolumeOutput) this.elementVolumeOutput.textContent = volume
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
    whenMIDIChannelSelectedRun(callback){
        if (!this.elementMIDIChannelSelector) return
        this.elementMIDIChannelSelector.addEventListener("change", e => {
            const channel = Number(this.elementMIDIChannelSelector.value)
            callback && callback(channel)
        })
    }

    /**
     * When the note visualiser is double pressed call
     * @param callback 
     */    
    whenNoteVisualiserDoubleClickedRun( callback){
        if (!this.noteVisualiserCanvas) return
        this.noteVisualiserCanvas.addEventListener( "dblclick", e => callback && callback(e) )   
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

        cancelAnimationFrame(this.clockAnimationFrame)

        this.clockAnimationFrame = requestAnimationFrame( ()=>{
            this.elementClock.textContent = `${String(bar).padStart(2, '0')}:${bars}:${String(barsElapsed).padStart(3, '0')} [${String(divisionsElapsed).padStart(2, '0')}] ${formatTimeStampFromSeconds(elapsed)} seconds`
            // this.elementClock.innerHTML = `${String(bar).padStart(2, '0')}:${bars}:${String(barsElapsed).padStart(3, '0')} [${String(divisionsElapsed).padStart(2, '0')}] ${formatTimeStampFromSeconds(elapsed)} seconds`
            // this.elementClock.innerHTML = `${bar}:${bars}:${barsElapsed} [${divisionsElapsed}] ${intervals}, ${elapsed.toFixed(2)} seconds`
        } )
    }

    /**
     * Show Note On
     * @param {NoteModel} note 
     */
    noteOn(note) {
        this.noteVisualiser.noteOn( note )
        this.keyboard.setKeyAsActive( note )
        this.addCommand("NoteOn #" + note.number )
    }

    /**
     * Show Note Off
     * @param {NoteModel} note 
     */
    noteOff(note) {
        this.noteVisualiser.noteOff( note )
        this.keyboard.setKeyAsInactive( note )
        this.removeCommand("NoteOff #" + note.number )
    }

    /**
     * Brute force!
     */
    allNotesOff(){
        for (let noteNumber = 0; noteNumber < 128; noteNumber++)
        {
            const noteModel = new NoteModel(noteNumber)
            this.noteOff(noteModel)
        }
    }

}