/**
 * Copy native .node modules to dist directory for Electron builds
 * This ensures the native MIDI module is available in packaged app
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

// Define source and destination paths for native modules
const nativeModuleConfigs = [
  {
    source: path.join(projectRoot, 'build', 'Release', 'midi2-native.node'),
    dest: path.join(projectRoot, 'dist', 'build', 'Release', 'midi2-native.node')
  }
]

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
    console.log(`Created directory: ${dirPath}`)
  }
}

function copyNativeModule(config) {
  const { source, dest } = config

  // Check if source exists
  if (!fs.existsSync(source)) {
    console.warn(`Warning: Native module not found at ${source}`)
    return false
  }

  try {
    // Ensure destination directory exists
    ensureDir(path.dirname(dest))

    // Copy the file
    fs.copyFileSync(source, dest)
    console.log(`Copied: ${source} → ${dest}`)
    return true
  } catch (error) {
    console.error(`Error copying native module: ${error.message}`)
    return false
  }
}

function main() {
  console.log('Copying native modules to dist directory...')
  console.log(`Project root: ${projectRoot}`)

  let allSuccess = true
  for (const config of nativeModuleConfigs) {
    if (!copyNativeModule(config)) {
      allSuccess = false
    }
  }

  if (allSuccess) {
    console.log('✓ All native modules copied successfully')
    process.exit(0)
  } else {
    console.warn('⚠ Some native modules could not be copied')
    process.exit(0) // Don't fail the build, native modules might not be needed in some contexts
  }
}

main()
