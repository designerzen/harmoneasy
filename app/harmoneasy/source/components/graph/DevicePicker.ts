import { elementDescription, elementIcon } from "./element-icons"
import {
	createInstrumentById,
	getInstrumentFactories
} from "audiobus/instruments/instrument-factory-ui.ts"
import { deviceAvailability, type RequiresDevices } from "audiobus/io/device-requirements"
import { createUnavailableSection, markUnavailable } from "./unavailable-choices"

import { createClassificationFilter } from "./ClassificationFilter"
import { choiceMatches, groupChoices, type ClassifiedChoice } from "./device-filters"
import { fillDeviceCard, createDeviceDetails, INPUT_GUIDANCE, OUTPUT_GUIDANCE } from "./device-card"
import { INPUT_DEFINITIONS } from "audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"
import {
	loadMidiProfilesForPorts,
	matchMidiDeviceProfile,
	MIDI_DEVICE_PROFILES,
	onMidiDeviceProfilesChanged
} from "audiobus/hardware/midi-devices/device-profiles"
import { sharedWebMidi } from "audiobus/midi/shared-webmidi"
import {
	EVENT_DEVICE_LIST_CHANGED,
	EVENT_READY,
	EVENT_CHAINS_UPDATED
} from "audiobus/events/event-constants"
import type AbstractInput from "audiobus/io/inputs/abstract-input"
import type { IAudioInput } from "audiobus/io/inputs/input-interface"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"

import type { ChainUIContext } from "./chain-ui-context"
import { createSharedDevices } from "./SharedDevices"
import { createLoader } from "../../libs/loader"
import { element, button, icon, searchReset } from "./dom"

type Choice = ClassifiedChoice & {
	kind: "input" | "output"
	instrumentId?: string
	factoryId?: string
	midiOptions?: Record<string, any>
	midiPortId?: string
	profileId?: string
	/** What this browser lacks to run it; empty when it can be added */
	missing: string[]
}

/** Factories this browser can run, plus the ones it cannot with why, minus hidden ones */
function withAvailability<T extends RequiresDevices>(factories: T[]) {
	return factories.flatMap((factory) => {
		const { hidden, missing } = deviceAvailability(factory)
		return hidden ? [] : [{ ...factory, missing }]
	})
}

export function createDevicePicker(
	context: ChainUIContext,
	{
		direction,
		replacing,
		audioProcessorsOnly = false,
		dialog = false,
		filterHeader,
		onAdded
	}: {
		direction: "input" | "output"
		audioProcessorsOnly?: boolean
		replacing?: AbstractInput | IAudioOutput
		dialog?: boolean
		filterHeader?: HTMLElement | null
		onAdded?: () => void
	}
) {
	const { chain, manager } = context
	let choices: Choice[] = [],
		classification = "",
		loading = true,
		busy = false,
		adding = false,
		error = "",
		destroyed = false,
		revision = 0
	const host = element("div", "device-picker")
	const row = element("div", "picker-filter-row")
	const label = element("div", dialog ? "dialog-filter" : "filter-label")
	const search = element("input", dialog ? "filter-input-global" : "")
	search.type = "search"
	search.autofocus = dialog
	search.placeholder = `Search ${direction}s…`
	search.setAttribute("aria-label", `Search ${direction}s`)
	label.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>'
	label.append(search)
	const filter = createClassificationFilter({
		choices: [],
		value: "",
		label: `Filter ${direction}s by type`,
		onChange: (value) => {
			classification = value
			render()
		}
	})
	const updateReset = searchReset(label, search, () => {
		search.value = ""
		filter.clear()
	})
	row.append(label, filter.element)
	;(filterHeader ?? host).append(row)
	const results = element("div")
	host.append(results)
	const select = (device: IAudioInput | IAudioOutput) => {
		if (destroyed || chain.isDestroyed) {
			void (device as any).destroy?.()
			return
		}
		if (replacing) {
			manager.replaceDevice(chain, replacing, device, direction)
		} else {
			manager.addDevice(chain, device, direction)
		}
		onAdded?.()
	}
	const add = async (choice: Choice) => {
		if (adding || choice.missing.length) {
			return
		}
		adding = true
		busy = true
		render()
		error = ""
		try {
			if (
				choice.midiPortId &&
				!(direction === "input" ? sharedWebMidi.inputs : sharedWebMidi.outputs).some(
					(port) => port.id === choice.midiPortId
				)
			) {
				throw new Error(
					`${choice.name} is no longer connected. Choose another MIDI device.`
				)
			}
			const ready = async (device: IAudioInput | IAudioOutput) => {
				if (choice.midiOptions) {
					try {
						await device.connect?.()
						if (
							choice.midiPortId &&
							!(
								direction === "input" ? sharedWebMidi.inputs : sharedWebMidi.outputs
							).some((port) => port.id === choice.midiPortId)
						) {
							throw new Error(
								`${choice.name} disconnected while being added. Choose another MIDI device.`
							)
						}
					} catch (error) {
						await (device as any).destroy?.()
						throw error
					}
				}
				return device
			}
			if (choice.kind === "input") {
				const { createInputById } = await import("audiobus/io/input-factory")
				select(
					await ready(
						await createInputById(
							choice.factoryId ?? choice.id,
							choice.midiOptions
								? { ...manager.deviceOptions, ...choice.midiOptions }
								: manager.deviceOptions
						)
					)
				)
			} else {
				const audioContext = manager.audioContext || (manager.outputMixer as any)?.context
				const options = manager.outputMixer
					? { mixer: manager.outputMixer, audioContext }
					: undefined
				if (choice.instrumentId) {
					select(await createInstrumentById(audioContext, choice.instrumentId, options))
				} else {
					const { createOutputById } = await import("audiobus/io/output-factory")
					select(
						await ready(
							await createOutputById(
								choice.factoryId ?? choice.id,
								choice.midiOptions ? { ...options, ...choice.midiOptions } : options
							)
						)
					)
				}
			}
		} catch (failure) {
			error = String(failure)
			render()
		} finally {
			adding = false
			busy = false
			if (!destroyed) {
				render()
			}
		}
	}
	function choiceItem(choice: Choice) {
		const item = element("li")
		const node = button("", () => void add(choice), dialog ? "grid-item" : "element-choice")
		node.disabled = busy
		node.title = choice.title
			? `${choice.title}: ${choice.description}`
			: elementDescription(choice.kind, choice.id, choice.name, choice.description)
		if (dialog) {
			fillDeviceCard(node, { ...choice, id: choice.factoryId ?? choice.id }, choice.kind)
			const profile = choice.profileId ? MIDI_DEVICE_PROFILES[choice.profileId] : undefined
			const image = node.querySelector<HTMLElement>(".item-icon")
			if (profile?.icon && image) {
				image.style.maskImage = `url("${profile.icon}")`
			}
		} else {
			node.append(
				icon(
					(choice.profileId ? MIDI_DEVICE_PROFILES[choice.profileId]?.icon : undefined) ??
						elementIcon(choice.kind, choice.factoryId ?? choice.id),
					node.title
				),
				element("span", "", choice.name)
			)
		}
		if (choice.missing.length) {
			markUnavailable(node, choice.missing)
		}
		item.append(node)
		if (dialog) {
			item.append(
				createDeviceDetails({ ...choice, id: choice.factoryId ?? choice.id }, choice.kind)
			)
		}
		return item
	}
	function render() {
		updateReset(Boolean(search.value || classification))
		if (destroyed) {
			return
		}
		const midiFactory = choices.find(
			(choice) =>
				choice.id === "webmidi" && choice.kind === direction && !choice.missing.length
		)
		const midiPorts = direction === "input" ? sharedWebMidi.inputs : sharedWebMidi.outputs
		const connectedChoices: Choice[] = midiFactory
			? midiPorts.map((port) => {
					const profileId = matchMidiDeviceProfile(port)
					const profile = profileId ? MIDI_DEVICE_PROFILES[profileId] : undefined
					return {
						...midiFactory,
						id: `webmidi:${port.id}`,
						factoryId: direction === "input" && profileId ? profileId : "webmidi",
						profileId,
						midiPortId: port.id,
						name: port.name || profile?.name || port.id,
						description: [
							port.manufacturer,
							profile?.description || `Connected MIDI ${direction}`,
							`MIDI ID: ${port.id}`
						]
							.filter(Boolean)
							.join(" · "),
						midiOptions: {
							transport: "webmidi",
							deviceId: port.id,
							selectedDevice: port.id,
							devices: [port.id],
							deviceName: port.name || port.id,
							...(direction === "input"
								? { listenToAllDevices: false }
								: { sendToAllDevices: false })
						}
					}
				})
			: []
		if (midiFactory && midiPorts.length) {
			connectedChoices.push({
				...midiFactory,
				id: "webmidi:all",
				factoryId: "webmidi",
				name: `All MIDI ${direction}s`,
				description: `Use all connected MIDI ${direction} devices.`,
				midiOptions: {
					selectedDevice: "",
					devices: [],
					...(direction === "input"
						? { listenToAllDevices: true }
						: { sendToAllDevices: true })
				}
			})
		}
		const listedChoices = [
			...choices.filter(
				(choice) =>
					!(choice.id === "webmidi" && midiFactory) &&
					// A disabled WebMIDI choice already explains why MIDI devices are missing
					!(
						direction === "input" &&
						MIDI_DEVICE_PROFILES[choice.id] &&
						(midiFactory || choice.missing.length)
					)
			),
			...connectedChoices
		]
		const matching = listedChoices.filter(
			(choice) =>
				(!audioProcessorsOnly ||
					(choice.type === "audio" && choice.subtype === "effect")) &&
				choiceMatches(choice, search.value, classification)
		)
		const filtered = matching.filter((choice) => !choice.missing.length)
		const unavailable = matching.filter((choice) => choice.missing.length)
		filter.update(
			listedChoices.filter(
				(choice) =>
					!audioProcessorsOnly || (choice.type === "audio" && choice.subtype === "effect")
			),
			search.value
		)
		host.setAttribute("aria-busy", String(loading || busy))
		const focusedEl = document.activeElement
		const focusedChoice =
			focusedEl instanceof HTMLElement && results.contains(focusedEl)
				? focusedEl.querySelector("span")?.textContent ?? focusedEl.textContent
				: undefined
		results.replaceChildren()
		const errorBanner = element("p", "")
		errorBanner.setAttribute("role", "alert")
		errorBanner.setAttribute("aria-live", "assertive")
		errorBanner.textContent = error
		if (error) {
			results.append(errorBanner)
		}
		const statusBanner = element("p", "")
		statusBanner.setAttribute("role", "status")
		statusBanner.setAttribute("aria-live", "polite")
		results.append(
			createSharedDevices(context, {
				direction,
				filterDevice: audioProcessorsOnly
					? (device) => Boolean(device.audioInput)
					: undefined,
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
				}
			})
		)
		const statusParts: string[] = []
		if (!loading && midiFactory && !midiPorts.length) {
			statusParts.push(`No MIDI ${direction} devices connected.`)
		}
		if (loading) {
			statusBanner.textContent = `Loading ${direction}s…`
			statusBanner.prepend(createLoader(), " ")
			results.append(statusBanner)
			return
		}
		if (filtered.length) {
			statusParts.push(`${filtered.length} matching ${direction}s`)
		} else if (!unavailable.length && !error) {
			statusParts.push(
				search.value || classification
					? `No ${direction}s match the selected filters`
					: `No ${direction}s available`
			)
		}
		statusBanner.textContent = statusParts.join(" · ")
		if (statusParts.length) {
			results.append(statusBanner)
		}
		for (const group of groupChoices(filtered)) {
			const section = element("section", "choice-group")
			section.setAttribute("aria-label", group.label)
			section.append(element("h3", "section-title", group.label))
			const list = element("ul", dialog ? "items-grid" : "")
			list.setAttribute("role", "list")
			list.append(...group.items.map(choiceItem))
			section.append(list)
			results.append(section)
		}
		if (unavailable.length) {
			results.append(
				createUnavailableSection(unavailable.map(choiceItem), dialog, `${direction}s`)
			)
		}
		if (focusedChoice) {
			const match = [...results.querySelectorAll<HTMLButtonElement>("button:not([disabled])")].find(
				(btn) => (btn.querySelector("span")?.textContent ?? btn.textContent) === focusedChoice
			)
			match?.focus()
		}
	}
	async function load() {
		const current = ++revision
		loading = true
		error = ""
		choices = []
		render()
		try {
			if (direction === "input") {
				const inputs = await chain.inputManager.getFactories()
				if (destroyed || current !== revision) {
					return
				}
				choices = withAvailability(inputs).map((factory) => ({
					...INPUT_DEFINITIONS[factory.id],
					...factory,
					keywords: Object.values(
						INPUT_GUIDANCE[factory.id as keyof typeof INPUT_GUIDANCE] ?? {}
					).join(" "),
					kind: "input"
				}))
			} else {
				const [outputs, instruments] = await Promise.allSettled([
					Promise.resolve().then(() => chain.outputManager.getFactories()),
					Promise.resolve().then(() => getInstrumentFactories())
				])
				if (destroyed || current !== revision) {
					return
				}
				error = [
					outputs.status === "rejected" ? "Outputs could not be loaded." : "",
					instruments.status === "rejected" ? "Some outputs could not be loaded." : ""
				]
					.filter(Boolean)
					.join(" ")
				const outputIds = new Set(
					outputs.status === "fulfilled" ? outputs.value.map((factory) => factory.id) : []
				)
				choices = [
					...(outputs.status === "fulfilled"
						? withAvailability(outputs.value).map((factory) => ({
								...OUTPUT_DEFINITIONS[factory.id],
								...factory,
								keywords: Object.values(
									OUTPUT_GUIDANCE[factory.id as keyof typeof OUTPUT_GUIDANCE] ??
										{}
								).join(" "),
								kind: "output" as const
							}))
						: []),
					...(instruments.status === "fulfilled"
						? withAvailability(instruments.value)
								.filter((factory) => !outputIds.has(factory.id))
								.map((factory) => ({
									...factory,
									kind: "output" as const,
									instrumentId: factory.id
								}))
						: [])
				]
			}
		} catch (failure) {
			if (!destroyed && current === revision) {
				error = String(failure)
			}
		} finally {
			if (!destroyed && current === revision) {
				loading = false
				render()
			}
		}
	}
	const changed = () => {
		render()
		void loadMidiProfilesForPorts(
			direction === "input" ? sharedWebMidi.inputs : sharedWebMidi.outputs
		).catch((error) => console.debug("MIDI device descriptions unavailable", error))
	}
	const unsubscribe = onMidiDeviceProfilesChanged(() => {
		if (!destroyed) {
			void load()
		}
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
		}
	}
}