import { elementDescription, elementIcon } from './element-icons'
import { createInstrumentById, getAvailableInstrumentFactories } from 'audiobus/instruments/instrument-factory-ui.ts'

import { createClassificationFilter } from './ClassificationFilter'
import { choiceMatches, groupChoices, type ClassifiedChoice } from './device-filters'
import { fillDeviceCard } from './device-card'
import {
	loadMidiProfilesForPorts,
	matchMidiDeviceProfile,
	MIDI_DEVICE_PROFILES,
	onMidiDeviceProfilesChanged,
} from 'audiobus/midi/hardware/device-profiles'
import { sharedWebMidi } from 'audiobus/midi/shared-webmidi'
import { EVENT_DEVICE_LIST_CHANGED, EVENT_READY, EVENT_CHAINS_UPDATED } from 'audiobus/event-constants'
import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioInput } from 'audiobus/io/inputs/input-interface'
import type { IAudioOutput } from 'audiobus/io/outputs/output-interface'

import type { ChainUIContext } from './chain-ui-context'
import { createSharedDevices } from './SharedDevices'
import { element, button, icon } from './dom'

type Choice = ClassifiedChoice & {
	kind: 'input' | 'output' | 'instrument'
	factoryId?: string
	midiOptions?: Record<string, any>
	midiPortId?: string
	profileId?: string
}

export function createDevicePicker(
	context: ChainUIContext,
	{
		direction,
		replacing,
		dialog = false,
		filterHeader,
		onAdded,
	}: {
		direction: 'input' | 'output'
		replacing?: AbstractInput | IAudioOutput
		dialog?: boolean
		filterHeader?: HTMLElement | null
		onAdded?: () => void
	},
) {
	const { chain, manager } = context
	let choices: Choice[] = [],
		classification = '',
		loading = true,
		busy = false,
		adding = false,
		error = '',
		destroyed = false,
		revision = 0
	const host = element('div', 'device-picker')
	const row = element('div', 'picker-filter-row')
	const label = element('label', dialog ? 'dialog-filter' : 'filter-label')
	const search = element('input', dialog ? 'filter-input-global' : '')
	search.type = 'search'
	search.autofocus = dialog
	search.placeholder = `Search ${direction}s…`
	search.setAttribute('aria-label', `Search ${direction}s`)
	label.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>'
	label.append(search)
	const filter = createClassificationFilter({
		choices: [],
		value: '',
		compact: true,
		label: `Filter ${direction}s by type`,
		onChange: (value) => {
			classification = value
			render()
		},
	})
	row.append(label, filter.element)
	;(filterHeader ?? host).append(row)
	const results = element('div')
	host.append(results)
	const select = (device: IAudioInput | IAudioOutput) => {
		if (destroyed || chain.isDestroyed) {
			void (device as any).destroy?.()
			return
		}
		if (replacing) manager.replaceDevice(chain, replacing, device, direction)
		else manager.addDevice(chain, device, direction)
		onAdded?.()
	}
	const add = async (choice: Choice) => {
		if (adding) return
		adding = true
		busy = true
		render()
		error = ''
		try {
			if (
				choice.midiPortId &&
				!(direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs).some(
					(port) => port.id === choice.midiPortId,
				)
			) {
				throw new Error(`${choice.name} is no longer connected. Choose another MIDI device.`)
			}
			const ready = async (device: IAudioInput | IAudioOutput) => {
				if (choice.midiOptions) {
					try {
						await device.connect?.()
						if (
							choice.midiPortId &&
							!(direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs).some(
								(port) => port.id === choice.midiPortId,
							)
						) {
							throw new Error(
								`${choice.name} disconnected while being added. Choose another MIDI device.`,
							)
						}
					} catch (error) {
						await (device as any).destroy?.()
						throw error
					}
				}
				return device
			}
			if (choice.kind === 'input') {
				const { createInputById } = await import('audiobus/io/input-factory')
				select(
					await ready(
						await createInputById(
							choice.factoryId ?? choice.id,
							choice.midiOptions
								? { ...manager.deviceOptions, ...choice.midiOptions }
								: manager.deviceOptions,
						),
					),
				)
			} else {
				const audioContext = manager.audioContext || (manager.outputMixer as any)?.context
				const options = manager.outputMixer ? { mixer: manager.outputMixer, audioContext } : undefined
				if (choice.kind === 'instrument') {
					select(await createInstrumentById(audioContext, choice.id, options))
				} else {
					const { createOutputById } = await import('audiobus/io/output-factory')
					select(
						await ready(
							await createOutputById(
								choice.factoryId ?? choice.id,
								choice.midiOptions ? { ...options, ...choice.midiOptions } : options,
							),
						),
					)
				}
			}
		} catch (failure) {
			error = String(failure)
			render()
		} finally {
			adding = false
			busy = false
			if (!destroyed) render()
		}
	}
	function render() {
		if (destroyed) return
		const midiFactory = choices.find((choice) => choice.id === 'webmidi' && choice.kind === direction)
		const midiPorts = direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs
		const connectedChoices: Choice[] = midiFactory
			? midiPorts.map((port) => {
					const profileId = matchMidiDeviceProfile(port)
					const profile = profileId ? MIDI_DEVICE_PROFILES[profileId] : undefined
					return {
						...midiFactory,
						id: `webmidi:${port.id}`,
						factoryId: direction === 'input' && profileId ? profileId : 'webmidi',
						profileId,
						midiPortId: port.id,
						name: port.name || profile?.name || port.id,
						description: [
							port.manufacturer,
							profile?.description || `Connected MIDI ${direction}`,
							`MIDI ID: ${port.id}`,
						]
							.filter(Boolean)
							.join(' · '),
						midiOptions: {
							transport: 'webmidi',
							deviceId: port.id,
							selectedDevice: port.id,
							devices: [port.id],
							deviceName: port.name || port.id,
							...(direction === 'input' ? { listenToAllDevices: false } : { sendToAllDevices: false }),
						},
					}
				})
			: []
		if (midiFactory && midiPorts.length)
			connectedChoices.push({
				...midiFactory,
				id: 'webmidi:all',
				factoryId: 'webmidi',
				name: `All MIDI ${direction}s`,
				description: `Use all connected MIDI ${direction} devices.`,
				midiOptions: {
					selectedDevice: '',
					devices: [],
					...(direction === 'input' ? { listenToAllDevices: true } : { sendToAllDevices: true }),
				},
			})
		const availableChoices = [
			...choices.filter(
				(choice) =>
					choice.id !== 'webmidi' &&
					!(midiFactory && direction === 'input' && MIDI_DEVICE_PROFILES[choice.id]),
			),
			...connectedChoices,
		]
		const filtered = availableChoices.filter((choice) => choiceMatches(choice, search.value, classification))
		filter.update(availableChoices)
		host.setAttribute('aria-busy', String(loading || busy))
		results.replaceChildren(
			createSharedDevices(context, {
				direction,
				search: search.value,
				selection: classification,
				disabled: busy,
				onSelect: (device) => {
					try {
						select(device)
					} catch (failure) {
						error = String(failure)
						render()
					}
				},
			}),
		)
		if (error) {
			const alert = element('p', '', error)
			alert.setAttribute('role', 'alert')
			results.append(alert)
		}
		const status = (text: string) => {
			const node = element('p', '', text)
			node.setAttribute('role', 'status')
			results.append(node)
		}
		if (!loading && midiFactory && !midiPorts.length) status(`No MIDI ${direction} devices connected.`)
		if (loading) {
			status(`Loading ${direction}s…`)
			return
		}
		for (const group of groupChoices(filtered)) {
			const section = element('section', 'choice-group')
			section.setAttribute('aria-label', group.label)
			section.append(element('h6', 'section-title', group.label))
			const list = element('ul', dialog ? 'items-grid' : '')
			list.setAttribute('role', 'list')
			for (const choice of group.items) {
				const item = element('li')
				const node = button('', () => void add(choice), dialog ? 'grid-item' : 'element-choice')
				node.disabled = busy
				node.title = choice.title
					? `${choice.title}: ${choice.description}`
					: elementDescription(choice.kind, choice.id, choice.name, choice.description)
				if (dialog) {
					fillDeviceCard(node, { ...choice, id: choice.factoryId ?? choice.id }, choice.kind)
					const profile = choice.profileId ? MIDI_DEVICE_PROFILES[choice.profileId] : undefined
					const image = node.querySelector<HTMLElement>('.item-icon')
					if (profile?.icon && image) image.style.maskImage = `url("${profile.icon}")`
				} else
					node.append(
						icon(
							(choice.profileId ? MIDI_DEVICE_PROFILES[choice.profileId]?.icon : undefined) ??
								elementIcon(choice.kind, choice.factoryId ?? choice.id),
							node.title,
						),
						element('span', '', choice.name),
					)
				item.append(node)
				list.append(item)
			}
			section.append(list)
			results.append(section)
		}
		if (!filtered.length && !error)
			status(
				search.value || classification
					? `No ${direction}s match the selected filters`
					: `No ${direction}s available`,
			)
	}
	async function load() {
		const current = ++revision
		loading = true
		error = ''
		choices = []
		render()
		try {
			if (direction === 'input') {
				const inputs = await chain.inputManager.getAvailableFactories()
				if (destroyed || current !== revision) return
				choices = inputs.map((factory) => ({ ...factory, kind: 'input' }))
			} else {
				const [outputs, instruments] = await Promise.allSettled([
					Promise.resolve().then(() => chain.outputManager.getAvailableFactories()),
					Promise.resolve().then(() => getAvailableInstrumentFactories()),
				])
				if (destroyed || current !== revision) return
				error = [
					outputs.status === 'rejected' ? 'Outputs could not be loaded.' : '',
					instruments.status === 'rejected' ? 'Instruments could not be loaded.' : '',
				]
					.filter(Boolean)
					.join(' ')
				choices = [
					...(outputs.status === 'fulfilled'
						? outputs.value.map((factory) => ({ ...factory, kind: 'output' as const }))
						: []),
					...(instruments.status === 'fulfilled'
						? instruments.value.map((factory) => ({ ...factory, kind: 'instrument' as const }))
						: []),
				]
			}
		} catch (failure) {
			if (!destroyed && current === revision) error = String(failure)
		} finally {
			if (!destroyed && current === revision) {
				loading = false
				render()
			}
		}
	}
	const changed = () => {
		render()
		void loadMidiProfilesForPorts(direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs).catch(
			(error) => console.debug('MIDI device descriptions unavailable', error),
		)
	}
	const unsubscribe = onMidiDeviceProfilesChanged(() => {
		if (!destroyed) void load()
	})
	sharedWebMidi.addEventListener(EVENT_DEVICE_LIST_CHANGED, changed)
	sharedWebMidi.addEventListener(EVENT_READY, changed)
	manager.addEventListener(EVENT_CHAINS_UPDATED, render)
	search.oninput = render
	void load()
	changed()
	return {
		element: host,
		destroy() {
			destroyed = true
			revision++
			unsubscribe()
			manager.removeEventListener(EVENT_CHAINS_UPDATED, render)
			sharedWebMidi.removeEventListener(EVENT_DEVICE_LIST_CHANGED, changed)
			sharedWebMidi.removeEventListener(EVENT_READY, changed)
			row.remove()
			host.remove()
		},
	}
}
