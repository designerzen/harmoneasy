/**
 * MIDI Transport Clock Input Example
 * Demonstrates how to use MIDI transport clock input to synchronize timing
 */

import IOChain from '../source/libs/audiobus/io/IO-chain'
import Timer from '../source/libs/audiobus/timing/timer'
import { createInputById } from '../source/libs/audiobus/io/input-factory'
import InputMIDITransportClock from '../source/libs/audiobus/io/inputs/input-midi-transport-clock'
import { MIDI_TRANSPORT_CLOCK } from '../source/libs/audiobus/io/inputs/input-types'

/**
 * Example 1: Basic MIDI Transport Clock Connection
 */
async function basicExample() {
  console.log('Example 1: Basic MIDI Transport Clock Connection')

  // Create a new transport clock input
  const clockInput = new InputMIDITransportClock({
    enabled: true,
    useNativeInput: true // Use native MIDI (Windows MIDI Services, CoreMIDI, ALSA)
  })

  try {
    // Connect to MIDI input
    await clockInput.connect()
    console.log('✓ Connected to MIDI transport clock')

    // Listen for transport commands
    clockInput.addEventListener('transportCommand', (event: CustomEvent) => {
      const detail = event.detail
      console.log(`Transport Command: ${detail.type}`)
      console.log(`  Timestamp: ${detail.timestamp}`)

      if (detail.type === 'midiClock') {
        console.log(`  BPM: ${detail.bpm}`)
        console.log(`  Quarter Note: ${detail.quarterNote}`)
      }
    })

    // Get current stats
    setInterval(() => {
      const stats = clockInput.clockStats
      console.log(`Clock Stats: ${stats.clockCount} clocks, ${stats.quarterNoteCount} quarter notes, BPM: ${stats.calculatedBPM}`)
    }, 5000)
  } catch (error) {
    console.error('Failed to connect to MIDI transport clock:', error)
  }
}

/**
 * Example 2: Integration with IOChain
 */
async function ioChainExample() {
  console.log('\nExample 2: Integration with IOChain')

  // Create timer and IO chain
  const timer = new Timer()
  const ioChain = new IOChain(timer)

  try {
    // Create MIDI transport clock input via factory
    const clockInput = await createInputById(MIDI_TRANSPORT_CLOCK, {
      useNativeInput: true
    })

    // Add to input manager
    ioChain.inputManager.add(clockInput)

    // Connect
    await (clockInput as InputMIDITransportClock).connect()
    console.log('✓ Added MIDI Transport Clock to IOChain')

    // Listen for input events (after they're processed by IOChain)
    ioChain.addEventListener('inputEvent', (event: Event) => {
      console.log('IOChain received input event')
    })

    // Monitor timer changes
    setInterval(() => {
      console.log(`Timer BPM: ${timer.BPM}, Running: ${timer.isRunning}`)
    }, 2000)
  } catch (error) {
    console.error('IOChain example error:', error)
  }
}

/**
 * Example 3: Synchronizing Multiple Inputs
 */
async function multipleInputsExample() {
  console.log('\nExample 3: Synchronizing Multiple Inputs')

  const timer = new Timer()
  const ioChain = new IOChain(timer)

  try {
    // Add keyboard input for notes
    const keyboardInput = await createInputById('keyboard')
    ioChain.inputManager.add(keyboardInput)
    await (keyboardInput as any).connect?.()

    // Add MIDI transport clock for timing
    const clockInput = await createInputById(MIDI_TRANSPORT_CLOCK, {
      useNativeInput: true
    })
    ioChain.inputManager.add(clockInput)
    await (clockInput as InputMIDITransportClock).connect()

    console.log('✓ Setup complete: Keyboard input + MIDI Transport Clock')
    console.log('  Notes from keyboard will be synchronized to MIDI clock timing')

    // Listen for all input events
    ioChain.addEventListener('inputEvent', (event: Event) => {
      console.log('Input event received and queued for processing')
    })
  } catch (error) {
    console.error('Multiple inputs example error:', error)
  }
}

/**
 * Example 4: Clock Statistics and Monitoring
 */
async function monitoringExample() {
  console.log('\nExample 4: Clock Statistics and Monitoring')

  const clockInput = new InputMIDITransportClock({
    useNativeInput: true
  })

  try {
    await clockInput.connect()
    console.log('✓ Connected to MIDI clock')

    // Create a monitoring dashboard
    const monitor = () => {
      const stats = clockInput.clockStats
      const progress = clockInput.getClockProgress()

      console.log('\n=== MIDI Clock Monitor ===')
      console.log(`Status: ${clockInput.isConnected ? '✓ Connected' : '✗ Disconnected'}`)
      console.log(`Total Clocks: ${stats.clockCount}`)
      console.log(`Quarter Notes: ${stats.quarterNoteCount}`)
      console.log(`Current BPM: ${stats.calculatedBPM}`)
      console.log(`Position in Quarter Note: ${progress}/24`)

      if (stats.calculatedBPM > 0) {
        const timePerQuarterNote = 60000 / stats.calculatedBPM
        const timePerClock = timePerQuarterNote / 24
        console.log(`Time per Clock: ${timePerClock.toFixed(2)}ms`)
      }
    }

    // Update monitoring every second
    setInterval(monitor, 1000)

    // Optionally reset stats
    setTimeout(() => {
      console.log('\nResetting statistics...')
      clockInput.resetStats()
      console.log('✓ Statistics reset')
    }, 10000)
  } catch (error) {
    console.error('Monitoring example error:', error)
  }
}

/**
 * Example 5: Conditional BPM Synchronization
 */
async function conditionalSyncExample() {
  console.log('\nExample 5: Conditional BPM Synchronization')

  const timer = new Timer()
  const clockInput = new InputMIDITransportClock({
    useNativeInput: true
  })

  let lastBPM = 0
  const BPM_THRESHOLD = 5 // Only update if change is > 5 BPM

  try {
    await clockInput.connect()

    clockInput.addEventListener('transportCommand', (event: CustomEvent) => {
      const detail = event.detail

      if (detail.type === 'midiClock') {
        const newBPM = detail.bpm
        const bpmDifference = Math.abs(newBPM - lastBPM)

        // Only update timer if significant change
        if (bpmDifference > BPM_THRESHOLD) {
          timer.BPM = newBPM
          console.log(`✓ Updated timer BPM to ${newBPM} (changed by ${bpmDifference})`)
          lastBPM = newBPM
        }
      }

      if (detail.transportCommand === 'start') {
        if (!timer.isRunning) {
          timer.start()
          console.log('✓ Started playback')
        }
      } else if (detail.transportCommand === 'stop') {
        if (timer.isRunning) {
          timer.stop()
          console.log('✓ Stopped playback')
        }
      }
    })

    console.log('✓ Conditional sync enabled')
  } catch (error) {
    console.error('Conditional sync example error:', error)
  }
}

/**
 * Run examples
 * Comment/uncomment to select which examples to run
 */
async function runExamples() {
  // await basicExample()
  // await ioChainExample()
  // await multipleInputsExample()
  // await monitoringExample()
  // await conditionalSyncExample()

  console.log('\nExamples available:')
  console.log('1. basicExample() - Basic connection and listening')
  console.log('2. ioChainExample() - Integration with IOChain')
  console.log('3. multipleInputsExample() - Keyboard + Clock')
  console.log('4. monitoringExample() - Clock statistics')
  console.log('5. conditionalSyncExample() - Smart BPM updates')
}

// Uncomment to run:
// runExamples().catch(console.error)

export { basicExample, ioChainExample, multipleInputsExample, monitoringExample, conditionalSyncExample }
