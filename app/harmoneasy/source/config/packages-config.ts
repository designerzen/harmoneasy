/**
 * Built-in packages configuration
 * This file contains metadata about packages included in the application
 */

export interface PackageInfo {
	name: string
	version: string
	description: string
	repo: string
}

export const PACKAGES: PackageInfo[] = [
	{
		name: 'netronome',
		version: '2.5.0',
		description: 'Rock solid JavaScript timing library with sub-millisecond accuracy',
		repo: 'https://github.com/designerzen/netronome'
	},
	{
		name: 'audiobus',
		version: '0.15.1',
		description: 'Core audio engine with MIDI processing, synthesis, and audio routing',
		repo: 'https://github.com/designerzen/harmoneasy'
	},
	{
		name: 'audiotool',
		version: '0.15.1',
		description: 'AudioTool SDK integration for HarmonEasy',
		repo: 'https://github.com/designerzen/harmoneasy'
	},
	{
		name: 'flodjs',
		version: '0.15.1',
		description: 'Flod.ts music composition library integration',
		repo: 'https://github.com/designerzen/harmoneasy'
	},
	{
		name: 'midi-ble',
		version: '0.15.1',
		description: 'Bluetooth MIDI (BLE) implementation for HarmonEasy',
		repo: 'https://github.com/designerzen/harmoneasy'
	},
	{
		name: 'opendaw',
		version: '0.15.1',
		description: 'OpenDAW project file format support and .dawProject integration',
		repo: 'https://github.com/designerzen/harmoneasy'
	},
	{
		name: 'pink-trombone',
		version: '0.15.1',
		description: 'Pink Trombone speech synthesis integration for HarmonEasy',
		repo: 'https://github.com/designerzen/harmoneasy'
	},
	{
		name: 'pitfalls',
		version: '0.15.1',
		description: 'Music theory utilities - scales, intervals, chords, and microtonality (EDO)',
		repo: 'https://github.com/designerzen/harmoneasy'
	}
]
