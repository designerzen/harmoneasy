/**
 * WAM2 Registry Integration - Usage Examples
 * 
 * These examples show how to use the WAM2 registry and OutputWAM2
 * to select and load WAM2 audio plugins from the online community registry
 */

import OutputWAM2 from '../source/libs/audiobus/io/outputs/output-wam2.ts'
import wam2Registry from '../source/libs/audiobus/io/outputs/wam/registry.ts'

// ============================================================================
// EXAMPLE 1: Basic Plugin Loading with Built-in GUI
// ============================================================================

async function example1_basicGuiUsage() {
  // Create audio context
  const audioContext = new AudioContext()
  
  // Create WAM2 output (no preset plugin needed)
  const wam = new OutputWAM2(audioContext, undefined, "My Synthesizer")
  
  // Create and display the GUI
  const gui = await wam.createGui()
  document.getElementById('container')!.appendChild(gui)
  
  // User clicks plugins in GUI to load them
  // Once loaded, you can play notes:
  wam.noteOn(60, 127)  // C4, full velocity
  setTimeout(() => wam.noteOff(60), 500)
}

// ============================================================================
// EXAMPLE 2: Programmatic Plugin Loading
// ============================================================================

async function example2_programmaticLoading() {
  const audioContext = new AudioContext()
  const wam = new OutputWAM2(audioContext)
  
  // Initialize registry
  await wam2Registry.initialize()
  
  // Find Synth-101 plugin
  const synth101 = wam2Registry.getById('com.sequencerParty.synth101')
  
  if (synth101) {
    // Load it programmatically
    await wam.loadPlugin(synth101)
    
    // Now it's ready to use
    wam.noteOn(64, 100)  // E4
    wam.noteOn(67, 100)  // G4
    wam.noteOn(72, 100)  // C5
    
    setTimeout(() => {
      wam.allNotesOff()
    }, 2000)
  }
}

// ============================================================================
// EXAMPLE 3: Search and Filter Plugins
// ============================================================================

async function example3_searchAndFilter() {
  await wam2Registry.initialize()
  
  // Search for all distortion effects
  const distortions = wam2Registry.search('distortion')
  console.log(`Found ${distortions.length} distortion plugins:`)
  distortions.forEach(plugin => {
    console.log(`  - ${plugin.name} (${plugin.vendor})`)
  })
  
  // Get only instruments/synthesizers
  const instruments = wam2Registry.getInstruments()
  console.log(`Found ${instruments.length} instruments`)
  
  // Get only effects
  const effects = wam2Registry.getEffects()
  console.log(`Found ${effects.length} effects`)
  
  // Get by specific category
  const reverbs = wam2Registry.getByCategory('Reverb')
  console.log(`Found ${reverbs.length} reverb effects`)
}

// ============================================================================
// EXAMPLE 4: Browse All Plugins Grouped by Category
// ============================================================================

async function example4_browseByCategory() {
  await wam2Registry.initialize()
  
  const grouped = wam2Registry.getGroupedByCategory()
  
  // Iterate through categories
  grouped.forEach((plugins, category) => {
    console.log(`\n${category} (${plugins.length} plugins):`)
    plugins.slice(0, 3).forEach(plugin => {  // Show first 3
      console.log(`  • ${plugin.name} - ${plugin.description.substring(0, 50)}...`)
    })
  })
}

// ============================================================================
// EXAMPLE 5: Create Custom Plugin Selector UI
// ============================================================================

async function example5_customSelectorUI() {
  const audioContext = new AudioContext()
  const wam = new OutputWAM2(audioContext)
  
  await wam2Registry.initialize()
  
  // Create custom HTML
  const container = document.createElement('div')
  container.style.padding = '20px'
  container.style.backgroundColor = '#f0f0f0'
  container.style.borderRadius = '8px'
  
  // Title
  const title = document.createElement('h2')
  title.textContent = 'Select a Synthesizer'
  container.appendChild(title)
  
  // Get instruments
  const instruments = wam2Registry.getInstruments()
  
  // Create buttons for each instrument
  instruments.slice(0, 5).forEach(plugin => {
    const button = document.createElement('button')
    button.textContent = `${plugin.name} (${plugin.vendor})`
    button.style.display = 'block'
    button.style.marginBottom = '8px'
    button.style.padding = '8px 16px'
    button.style.cursor = 'pointer'
    
    button.addEventListener('click', async () => {
      try {
        await wam.loadPlugin(plugin)
        console.log(`Loaded: ${plugin.name}`)
      } catch (error) {
        console.error('Failed to load plugin:', error)
      }
    })
    
    container.appendChild(button)
  })
  
  document.body.appendChild(container)
  
  return wam
}

// ============================================================================
// EXAMPLE 6: Sequential Note Sequence with WAM2
// ============================================================================

async function example6_noteSequence() {
  const audioContext = new AudioContext()
  const wam = new OutputWAM2(audioContext)
  
  // Use the built-in GUI
  const gui = await wam.createGui()
  document.getElementById('container')!.appendChild(gui)
  
  // Wait a bit for user to select a plugin, then play a sequence
  setTimeout(() => {
    const notes = [60, 62, 64, 65, 67]  // C major scale
    const tempo = 400  // milliseconds per note
    
    notes.forEach((note, index) => {
      const time = index * tempo
      
      setTimeout(() => {
        wam.noteOn(note, 100)
      }, time)
      
      setTimeout(() => {
        wam.noteOff(note)
      }, time + tempo * 0.8)
    })
  }, 1000)
}

// ============================================================================
// EXAMPLE 7: MIDI Control Change (CC) Messages
// ============================================================================

async function example7_midiControlChanges() {
  const audioContext = new AudioContext()
  const wam = new OutputWAM2(audioContext)
  
  // Load a specific plugin with parameters
  await wam2Registry.initialize()
  const synth = wam2Registry.getById('com.sequencerParty.synth101')
  
  if (synth) {
    await wam.loadPlugin(synth)
    
    // Play a note
    wam.noteOn(60, 100)
    
    // Send CC messages for parameter control
    // CC#1 = Modulation Wheel
    wam.sendControlChange(1, 64, 0)
    
    // CC#7 = Volume
    wam.sendControlChange(7, 100, 0)
    
    // CC#74 = Brightness
    wam.sendControlChange(74, 80, 0)
    
    setTimeout(() => wam.noteOff(60), 3000)
  }
}

// ============================================================================
// EXAMPLE 8: Get Plugin Metadata and Thumbnail
// ============================================================================

async function example8_pluginMetadata() {
  await wam2Registry.initialize()
  
  const plugin = wam2Registry.getById('com.sequencerParty.synth101')
  
  if (plugin) {
    console.log('Plugin Name:', plugin.name)
    console.log('Vendor:', plugin.vendor)
    console.log('Description:', plugin.description)
    console.log('Keywords:', plugin.keywords.join(', '))
    console.log('Categories:', plugin.category.join(', '))
    console.log('Website:', plugin.website || 'N/A')
    
    // Get URLs
    const pluginUrl = wam2Registry.getPluginUrl(plugin)
    const thumbUrl = wam2Registry.getThumbnailUrl(plugin)
    
    console.log('Plugin URL:', pluginUrl)
    console.log('Thumbnail URL:', thumbUrl)
    
    // Display thumbnail if available
    if (thumbUrl) {
      const img = new Image()
      img.src = thumbUrl
      img.style.maxWidth = '300px'
      document.body.appendChild(img)
    }
  }
}

// ============================================================================
// EXAMPLE 9: Integration with HarmonEasy Graph
// ============================================================================

async function example9_harmonEasyIntegration() {
  // This example shows how WAM2 integrates with HarmonEasy's IO chain
  
  const audioContext = new AudioContext()
  
  // In HarmonEasy, when you create an OutputNode with OutputWAM2:
  const wam = new OutputWAM2(audioContext)
  
  // The OutputNode component will automatically:
  // 1. Check if wam.createGui exists
  // 2. Call createGui() to get the GUI element
  // 3. Add it to the node's GUI container
  // 4. Call destroyGui() when the node is removed
  
  // Example OutputNode usage (from OutputNode.tsx):
  /*
  const gui = await output.createGui?.()
  if (gui && GUIContainerRef.current) {
    GUIContainerRef.current.appendChild(gui)
  }
  */
  
  // So you just need to add the OutputWAM2 to the IO chain:
  // const chain = (window as any).chain as IOChain
  // chain.addOutput(wam)
  
  console.log('WAM2 is now integrated with HarmonEasy graph!')
}

// ============================================================================
// EXAMPLE 10: Error Handling
// ============================================================================

async function example10_errorHandling() {
  try {
    const audioContext = new AudioContext()
    const wam = new OutputWAM2(audioContext)
    
    // This might fail if registry is unreachable
    const gui = await wam.createGui()
    document.getElementById('container')!.appendChild(gui)
    
  } catch (error) {
    console.error('Failed to create GUI:', error)
    // Fallback to manual setup
    console.log('Falling back to programmatic setup...')
    
    try {
      const audioContext = new AudioContext()
      const wam = new OutputWAM2(audioContext)
      
      // Try to load a plugin directly if you know the URL
      // await wam.connect()
    } catch (error2) {
      console.error('Complete failure:', error2)
    }
  }
}

// ============================================================================
// Export examples for testing
// ============================================================================

export {
  example1_basicGuiUsage,
  example2_programmaticLoading,
  example3_searchAndFilter,
  example4_browseByCategory,
  example5_customSelectorUI,
  example6_noteSequence,
  example7_midiControlChanges,
  example8_pluginMetadata,
  example9_harmonEasyIntegration,
  example10_errorHandling,
}
