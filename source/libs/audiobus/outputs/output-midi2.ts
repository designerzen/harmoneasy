/**
 * MIDI 2.0 Output - Universal MIDI Packet (UMP) Implementation
 * Supports high-resolution controllers, per-note effects, and MIDI-CI
 */

import { IAudioOutput, IAudioOutputDeviceInfo } from '../interfaces/audio-output.js';
import { AudioCommand } from '../audio-command.js';

/**
 * MIDI 2.0 specific audio command extensions
 */
export interface MIDI2AudioCommand extends AudioCommand {
	midi2?: {
		// High-resolution velocity (0-65535, vs MIDI 1: 0-127)
		velocity?: number;

		// 32-bit fixed point pitch
		pitch?: number;

		// Per-note controllers
		performanceData?: {
			vibrato?: number;      // 0-65535 (16-bit)
			brightness?: number;   // 0-65535 (16-bit)
			timbre?: number;       // 0-65535 (16-bit)
			releaseTension?: number; // 0-65535 (16-bit)
			attackTime?: number;   // milliseconds
		};

		// Velocity performance (MIDI 2.0)
		velocityPerformance?: {
			attackTime?: number;   // Attack time
			releaseVelocity?: number; // 0-65535
		};

		// Timestamp (for jitter reduction)
		timestamp?: number;
	};
}

/**
 * MIDI 2.0 UMP Packet Structure
 * 32-bit word with:
 * - Bits 0-3: Message Type
 * - Bits 4-7: Group (0-15)
 * - Bits 8-11: Status
 * - Bits 12-15: Channel
 * - Bits 16-31: Data
 */
export type UMPPacket = number;

/**
 * UMP Message Types
 */
enum UMPMessageType {
	UTILITY = 0x0,           // Utility Message
	SYSTEM_REALTIME = 0x1,   // System Real Time
	SYSTEM_COMMON = 0x2,     // System Common
	MIDI1_CHANNEL_VOICE = 0x3, // MIDI 1 Channel Voice
	DATA = 0x4,              // Data Message
	FLEX_DATA = 0x5,         // Flex Data Message
	EXTENDED_DATA = 0x6,     // Extended Data Message
	RESERVED = 0x7,          // Reserved
	CHANNEL_VOICE = 0x8,     // MIDI 2.0 Channel Voice (64-bit)
	STREAM = 0x9,            // Stream Message (64-bit)
	SYSEX = 0xA,             // System Exclusive
	RESERVED_B = 0xB,        // Reserved
	RESERVED_C = 0xC,        // Reserved
	RESERVED_D = 0xD,        // Reserved
	RESERVED_E = 0xE,        // Reserved
	RESERVED_F = 0xF         // Reserved
}

/**
 * Channel Voice Status (MIDI 2.0)
 */
enum ChannelVoiceStatus {
	NOTE_OFF = 0x0,
	NOTE_ON = 0x1,
	POLY_PRESSURE = 0x2,
	CONTROL_CHANGE = 0x3,
	PROGRAM_CHANGE = 0x4,
	CHANNEL_PRESSURE = 0x5,
	PITCH_BEND = 0x6,
	PER_NOTE_CC = 0x7
}

/**
 * UMP Helper Functions
 */
export class UMPHelper {
	/**
	 * Create Note On UMP packet
	 */
	static createNoteOn(
		group: number,
		channel: number,
		note: number,
		velocity: number,
		performanceData?: MIDI2AudioCommand['midi2']['performanceData']
	): UMPPacket {
		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.NOTE_ON;

		const byte0 = (messageType << 4) | group;
		const byte1 = (status << 4) | channel;

		// Combine note and velocity into 32-bit data
		const data = (note << 24) | (velocity & 0xFFFF);

		return (byte0 << 24) | (byte1 << 16) | (data & 0xFFFF);
	}

	/**
	 * Create Note Off UMP packet
	 */
	static createNoteOff(
		group: number,
		channel: number,
		note: number,
		velocity: number
	): UMPPacket {
		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.NOTE_OFF;

		const byte0 = (messageType << 4) | group;
		const byte1 = (status << 4) | channel;
		const data = (note << 24) | (velocity & 0xFFFF);

		return (byte0 << 24) | (byte1 << 16) | (data & 0xFFFF);
	}

	/**
	 * Create Control Change UMP packet (16-bit value)
	 */
	static createControlChange(
		group: number,
		channel: number,
		controller: number,
		value: number
	): UMPPacket {
		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.CONTROL_CHANGE;

		const byte0 = (messageType << 4) | group;
		const byte1 = (status << 4) | channel;
		const data = (controller << 24) | (value & 0xFFFF);

		return (byte0 << 24) | (byte1 << 16) | (data & 0xFFFF);
	}

	/**
	 * Create Per-Note Controller UMP packet
	 */
	static createPerNoteController(
		group: number,
		channel: number,
		note: number,
		controller: number,
		value: number
	): UMPPacket {
		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.PER_NOTE_CC;

		const byte0 = (messageType << 4) | group;
		const byte1 = (status << 4) | channel;
		const data = (note << 24) | (controller << 16) | (value & 0xFFFF);

		return (byte0 << 24) | (byte1 << 16) | (data & 0xFFFF);
	}

	/**
	 * Create Pitch Bend UMP packet (32-bit precision)
	 */
	static createPitchBend(
		group: number,
		channel: number,
		pitch: number
	): UMPPacket {
		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.PITCH_BEND;

		const byte0 = (messageType << 4) | group;
		const byte1 = (status << 4) | channel;

		return (byte0 << 24) | (byte1 << 16) | (pitch & 0xFFFF);
	}

	/**
	 * Create Program Change UMP packet
	 */
	static createProgramChange(
		group: number,
		channel: number,
		program: number
	): UMPPacket {
		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.PROGRAM_CHANGE;

		const byte0 = (messageType << 4) | group;
		const byte1 = (status << 4) | channel;
		const data = program & 0x00FFFFFF;

		return (byte0 << 24) | (byte1 << 16) | data;
	}

	/**
	 * Convert MIDI 1 velocity (0-127) to MIDI 2.0 (0-65535)
	 */
	static velocityMidi1ToMidi2(velocity: number): number {
		return Math.round((velocity / 127) * 65535);
	}

	/**
	 * Convert MIDI 2.0 velocity (0-65535) to MIDI 1 (0-127)
	 */
	static velocityMidi2ToMidi1(velocity: number): number {
		return Math.round((velocity / 65535) * 127);
	}

	/**
	 * Convert cents to MIDI 2.0 pitch (32-bit fixed point)
	 * 0x80000000 = center (no transposition)
	 * Each semitone = 0x00800000
	 */
	static centsToPitch(cents: number): number {
		const semitones = cents / 100;
		const pitchValue = 0x80000000 + Math.round(semitones * 0x00800000);
		return pitchValue >>> 0; // Ensure unsigned
	}

	/**
	 * Convert MIDI 2.0 pitch to cents
	 */
	static pitchToCents(pitch: number): number {
		const offset = (pitch | 0) - 0x80000000;
		const semitones = offset / 0x00800000;
		return semitones * 100;
	}
}

/**
 * MIDI 2.0 Output Implementation
 * Sends UMP (Universal MIDI Packet) messages
 */
export class OutputMIDI2 implements IAudioOutput {
	private deviceIndex: number;
	private deviceInfo: IAudioOutputDeviceInfo;
	private isOpen: boolean = false;
	private midi2Native: any = null;
	private currentGroup: number = 0;

	constructor(deviceIndex: number, deviceInfo: IAudioOutputDeviceInfo) {
		this.deviceIndex = deviceIndex;
		this.deviceInfo = deviceInfo;

		// Try to load native MIDI2 binding
		try {
			this.midi2Native = require('../../../build/Release/midi2-native.node');
		} catch (error) {
			console.warn('[OutputMIDI2] Native module not available, falling back to MIDI 1 API');
			// Fallback to WebMIDI or other available API
		}
	}

	/**
	 * Open the MIDI 2.0 output device
	 */
	async open(): Promise<void> {
		if (this.isOpen) return;

		if (this.midi2Native) {
			try {
				this.midi2Native.openUmpOutput(this.deviceIndex);
				this.isOpen = true;
				console.log(`[OutputMIDI2] Opened: ${this.deviceInfo.name}`);
			} catch (error) {
				console.error(`[OutputMIDI2] Failed to open device: ${error}`);
				throw error;
			}
		} else {
			throw new Error('MIDI 2.0 native module not available');
		}
	}

	/**
	 * Close the MIDI 2.0 output device
	 */
	async close(): Promise<void> {
		if (!this.isOpen) return;

		if (this.midi2Native) {
			try {
				this.midi2Native.closeUmpOutput(this.deviceIndex);
				this.isOpen = false;
				console.log(`[OutputMIDI2] Closed: ${this.deviceInfo.name}`);
			} catch (error) {
				console.error(`[OutputMIDI2] Failed to close device: ${error}`);
			}
		}
	}

	/**
	 * Send audio command as MIDI 2.0 UMP packets
	 */
	async send(command: AudioCommand | MIDI2AudioCommand): Promise<void> {
		if (!this.isOpen) {
			throw new Error('MIDI 2.0 output not open');
		}

		const midi2Cmd = command as MIDI2AudioCommand;
		const packets: UMPPacket[] = [];

		switch (command.type) {
			case 'note':
				packets.push(...this.noteToUmp(midi2Cmd));
				break;

			case 'note-off':
				packets.push(...this.noteOffToUmp(midi2Cmd));
				break;

			case 'control-change':
				packets.push(...this.ccToUmp(midi2Cmd));
				break;

			case 'program-change':
				packets.push(...this.pcToUmp(midi2Cmd));
				break;

			case 'pitch-bend':
				packets.push(...this.pitchBendToUmp(midi2Cmd));
				break;

			case 'pressure':
				packets.push(...this.pressureToUmp(midi2Cmd));
				break;

			default:
				console.warn(`[OutputMIDI2] Unsupported command type: ${(command as any).type}`);
				return;
		}

		// Send all packets
		for (const packet of packets) {
			this.sendUmp(packet);
		}
	}

	/**
	 * Send raw UMP packet
	 */
	private sendUmp(packet: UMPPacket): void {
		if (!this.midi2Native) return;

		try {
			this.midi2Native.sendUmp(this.deviceIndex, packet);
		} catch (error) {
			console.error(`[OutputMIDI2] Failed to send UMP: ${error}`);
		}
	}

	/**
	 * Convert Note On command to UMP packets
	 */
	private noteToUmp(command: MIDI2AudioCommand): UMPPacket[] {
		const packets: UMPPacket[] = [];
		const velocity = command.midi2?.velocity ?? UMPHelper.velocityMidi1ToMidi2(command.velocity || 100);
		const channel = (command.channel || 0) % 16;

		// Send Note On with high-res velocity
		packets.push(UMPHelper.createNoteOn(this.currentGroup, channel, command.note, velocity, command.midi2?.performanceData));

		// Send per-note controllers if provided
		if (command.midi2?.performanceData) {
			const perf = command.midi2.performanceData;

			if (perf.vibrato !== undefined) {
				packets.push(UMPHelper.createPerNoteController(this.currentGroup, channel, command.note, 0x01, perf.vibrato));
			}

			if (perf.brightness !== undefined) {
				packets.push(UMPHelper.createPerNoteController(this.currentGroup, channel, command.note, 0x02, perf.brightness));
			}

			if (perf.timbre !== undefined) {
				packets.push(UMPHelper.createPerNoteController(this.currentGroup, channel, command.note, 0x03, perf.timbre));
			}

			if (perf.releaseTension !== undefined) {
				packets.push(UMPHelper.createPerNoteController(this.currentGroup, channel, command.note, 0x04, perf.releaseTension));
			}
		}

		return packets;
	}

	/**
	 * Convert Note Off command to UMP packets
	 */
	private noteOffToUmp(command: MIDI2AudioCommand): UMPPacket[] {
		const velocity = command.midi2?.velocity ?? UMPHelper.velocityMidi1ToMidi2(command.velocity || 0);
		const channel = (command.channel || 0) % 16;

		return [UMPHelper.createNoteOff(this.currentGroup, channel, command.note, velocity)];
	}

	/**
	 * Convert Control Change to UMP (16-bit resolution)
	 */
	private ccToUmp(command: MIDI2AudioCommand): UMPPacket[] {
		const channel = (command.channel || 0) % 16;
		const controller = command.controller || 0;
		// MIDI 1: 0-127 → MIDI 2: 0-65535
		const value = Math.round(((command.value || 0) / 127) * 65535);

		return [UMPHelper.createControlChange(this.currentGroup, channel, controller, value)];
	}

	/**
	 * Convert Program Change to UMP
	 */
	private pcToUmp(command: MIDI2AudioCommand): UMPPacket[] {
		const channel = (command.channel || 0) % 16;
		const program = (command.value || 0) % 128;

		return [UMPHelper.createProgramChange(this.currentGroup, channel, program)];
	}

	/**
	 * Convert Pitch Bend to UMP (32-bit precision)
	 */
	private pitchBendToUmp(command: MIDI2AudioCommand): UMPPacket[] {
		const channel = (command.channel || 0) % 16;
		// Convert cents to pitch value
		const pitch = UMPHelper.centsToPitch(command.value || 0);

		return [UMPHelper.createPitchBend(this.currentGroup, channel, pitch)];
	}

	/**
	 * Convert Pressure/Channel Pressure to UMP
	 */
	private pressureToUmp(command: MIDI2AudioCommand): UMPPacket[] {
		const channel = (command.channel || 0) % 16;
		// Pressure is 16-bit in MIDI 2
		const pressure = Math.round(((command.value || 0) / 127) * 65535);

		const messageType = UMPMessageType.CHANNEL_VOICE;
		const status = ChannelVoiceStatus.CHANNEL_PRESSURE;
		const byte0 = (messageType << 4) | this.currentGroup;
		const byte1 = (status << 4) | channel;

		return [((byte0 << 24) | (byte1 << 16) | pressure) >>> 0];
	}

	/**
	 * Get device information
	 */
	getInfo(): IAudioOutputDeviceInfo {
		return this.deviceInfo;
	}

	/**
	 * Check if output is open
	 */
	isOpened(): boolean {
		return this.isOpen;
	}

	/**
	 * Set UMP group (0-15)
	 */
	setGroup(group: number): void {
		this.currentGroup = Math.min(15, Math.max(0, group));
	}

	/**
	 * Get supported MIDI 2.0 features
	 */
	getSupportedFeatures(): string[] {
		return [
			'midi2-channel-voice',
			'midi2-per-note-controllers',
			'midi2-high-resolution-velocity',
			'midi2-32bit-pitch',
			'midi2-midi-ci'
		];
	}
}
