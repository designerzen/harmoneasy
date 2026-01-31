/**
 * WAM2 (Web Audio Modules 2) Integration
 * 
 * This folder contains all WAM2-related functionality:
 * - registry: Plugin registry manager and discovery
 * - OutputWAM2: Audio output implementation
 */

export { WAM2Registry, type WAM2PluginDescriptor } from "./registry.ts"
export { default as wam2Registry } from "./registry.ts"
