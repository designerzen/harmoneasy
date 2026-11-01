import { createDomControl } from "./dom"
import { contactPressure } from "./pressure"
import { sourceTheme } from "./themes"
import { isMusicGrid, musicOptions, musicRect, musicValues } from "./music"
import { toolPages } from "./tool-pages"
import { resizeMusicGrid } from "./music-dom"
import { relativeRect } from "./relative-keys"
import {
	EVENT_RESIZE,
	EVENT_ABORT,
	EVENT_BLUR,
	EVENT_FOCUS_IN,
	EVENT_FOCUS_OUT,
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_DRAG_START,
	EVENT_DRAG_OVER,
	EVENT_DROP,
	EVENT_SUBMIT,
	EVENT_KEY_DOWN,
	EVENT_LOST_POINTER_CAPTURE,
	EVENT_POINTER_CANCEL,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_VISIBILITY_CHANGE
} from "./events"
import {
	bindingKey,
	clamp,
	denormalize,
	dialOptions,
	dialPosition,
	layoutWidgets,
	normalize,
	sameValue,
	validateValue,
	widgetChoices,
	ergonomicOrder
} from "./model"
import { widgetPoint } from "./model"
import { playingLayout } from "./layout"
import { GpuSurfaceRenderer, type WidgetVisual } from "./renderer"
import type {
	ControlBinding,
	ControlValue,
	SurfaceState,
	SurfaceWidget,
	SurfaceVisualEffects
} from "./types"

const largeWidget = (widget: string) =>
	isMusicGrid(widget) || widget === "relative-keys" || widget === "strum"

interface Entry {
	page?: number
	tools?: ReturnType<typeof toolPages>
	config: SurfaceWidget
	binding: ControlBinding
	visual: WidgetVisual
	element: HTMLElement
	update(value: ControlValue | undefined): void
	version: number
	busy: boolean
	pending?: ControlValue
	actions: ControlValue[]
	missing: boolean
	reading: boolean
	dirty: boolean
	semanticDirty: boolean
	release?(): void
}
interface Gesture {
	entry: Entry
	startY: number
	startValue: number
	axis: number
	pressure: number
	angle?: number
	position: number
}
export interface SurfaceOptions {
	/** Continuous quarter-note position from the shared transport; undefined when stopped. */
	beatPosition?(): number | undefined
	visualEffects?: SurfaceVisualEffects
	state: SurfaceState
	bindings: ControlBinding[]
	toolbarHost?: HTMLElement
	addControls?: { label: string; action(): void }[]
	change(state: SurfaceState): void
	configurationChanged?(): void
}

/** DOM owns semantics and input; a single WebGPU canvas draws all widget faces and text. */
export class ControlSurface {
	readonly element = document.createElement("section")
	readonly canvas = document.createElement("canvas")
	private stage = document.createElement("div")
	private viewport = document.createElement("div")
	private playGuide = document.createElement("p")
	private pageNavigation = document.createElement("div")
	private pageLabel = document.createElement("span")
	private currentPage = 0
	private pageCount = 1
	private pageHeight = 400
	private layoutMode = ""
	private status = document.createElement("p")
	private abort = new AbortController()
	private previousPage = this.button("Previous page", () => this.showPage(this.currentPage - 1))
	private nextPage = this.button("Next page", () => this.showPage(this.currentPage + 1))

	private renderer?: GpuSurfaceRenderer
	private entries: Entry[] = []
	private unsubscribers: (() => void)[] = []
	private gestures = new Map<number, Gesture>()
	private pressurePointers = new Set<number>()
	private resize: ResizeObserver
	private intersection: IntersectionObserver
	private visible = true
	private disposed = false
	private editing = false
	private frame = 0
	private poll = 0
	private height = 120
	private stageWidth = 640
	private pointerRect?: DOMRect
	private motion = matchMedia("(prefers-reduced-motion: reduce)")
	private recovering = false
	private xr?: { end(): Promise<void> }
	private enteringXR = false
	private vrButton: HTMLButtonElement
	private toolbar = document.createElement("div")
	private sourceKey = document.createElement("ul")
	private layoutStatus = document.createElement("p")
	private layoutActions = document.createElement("div")

	constructor(private options: SurfaceOptions) {
		this.element.className = "control-surface nodrag nopan nowheel"
		this.element.dataset.midiScope = `surface:${options.state.id}`
		this.element.dataset.midiLabel = options.state.name
		this.element.addEventListener(EVENT_KEY_DOWN, (event) => event.stopPropagation(), {
			signal: this.abort.signal
		})
		this.stage.className = "cs-stage"
		this.canvas.setAttribute("aria-hidden", "true")
		this.stage.append(this.canvas)
		this.viewport.className = "cs-viewport"
		this.viewport.tabIndex = 0
		this.viewport.setAttribute("role", "region")
		this.viewport.setAttribute("aria-label", "Control gadgets")
		this.viewport.append(this.stage)
		this.playGuide.className = "cs-play-guide"
		this.playGuide.setAttribute("role", "status")
		this.pageNavigation.className = "cs-page-navigation"
		this.pageNavigation.setAttribute("aria-label", "Gadget pages")
		this.pageLabel.setAttribute("role", "status")
		this.pageNavigation.append(this.previousPage, this.pageLabel, this.nextPage)
		const toolbar = this.toolbar
		toolbar.className = "cs-toolbar"
		const name = document.createElement("input")
		name.setAttribute("aria-label", "Surface name")
		name.className = "cs-title"
		name.maxLength = 100
		name.value = options.state.name
		name.addEventListener(
			EVENT_CHANGE,
			() => {
				const value = name.value.trim()
				if (value) {
					options.state.name = value
					this.element.dataset.midiLabel = value
					this.save()
				}
				name.value = options.state.name
			},
			{ signal: this.abort.signal }
		)
		name.addEventListener(
			EVENT_KEY_DOWN,
			(event) => {
				if (event.key === "Enter") {
					name.blur()
				} else if (event.key === "Escape") {
					event.stopPropagation()
					name.value = options.state.name
					name.blur()
				}
			},
			{ signal: this.abort.signal }
		)
		const edit = this.button("Edit layout", () => {
			this.editing = !this.editing
			edit.textContent = this.editing ? "Perform" : "Edit layout"
			edit.setAttribute("aria-pressed", String(this.editing))
			this.rebuild()
		})
		edit.setAttribute("aria-pressed", "false")
		const theme = document.createElement("select")
		theme.setAttribute("aria-label", "Surface theme")
		for (const value of ["neon", "amber", "ice"] as const) {
			const option = document.createElement("option")
			option.value = value
			option.textContent = value
			theme.append(option)
		}
		theme.value = options.state.theme ?? "neon"
		theme.addEventListener(
			EVENT_CHANGE,
			() => {
				options.state.theme = theme.value as SurfaceState["theme"]
				this.renderer?.setTheme(options.state.theme!)
				this.save()
			},
			{ signal: this.abort.signal }
		)
		this.vrButton = this.button("Enter VR", () => void this.enterXR())
		const settings = document.createElement("div")
		settings.className = "cs-settings"
		const menu = document.createElement("div")
		menu.className = "cs-settings-menu"
		menu.hidden = true
		menu.id = `cs-settings-${crypto.randomUUID()}`
		const toggle = this.button("", () => {
			menu.hidden = !menu.hidden
			toggle.setAttribute("aria-expanded", String(!menu.hidden))
		})
		toggle.title = "Surface settings"
		toggle.setAttribute("aria-label", "Surface settings")
		toggle.setAttribute("aria-expanded", "false")
		toggle.setAttribute("aria-controls", menu.id)
		toggle.innerHTML =
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-1Z"/><circle cx="12" cy="10.5" r="3"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
		const closeMenu = () => {
			menu.hidden = true
			toggle.setAttribute("aria-expanded", "false")
		}
		for (const item of options.addControls ?? []) {
			const control = this.button(item.label, () => {
				closeMenu()
				item.action()
			})
			const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
			icon.setAttribute("viewBox", "0 0 24 24")
			icon.setAttribute("aria-hidden", "true")
			icon.innerHTML = '<path d="M2 12h3l3-8 4 16 4-16 3 8h3"/>'
			control.prepend(icon)
			menu.append(control)
		}
		const xy = this.button("Add XY pad", () => {
			closeMenu()
			this.addXY()
		})
		const xyIcon = toggle.firstElementChild!.cloneNode(true) as SVGElement
		xyIcon.innerHTML = '<path d="M3 4h6v16H3zM15 4h6v16h-6zM9 12h6"/>'
		xy.prepend(xyIcon)
		menu.append(xy)
		const themeLabel = document.createElement("label")
		themeLabel.append(toggle.firstElementChild!.cloneNode(true), "Theme", theme)
		menu.append(themeLabel)
		if (options.beatPosition) {
			const label = document.createElement("label"),
				enabled = document.createElement("input")
			label.className = "cs-beat-toggle"
			enabled.type = "checkbox"
			enabled.checked = options.state.beatCues !== false
			enabled.addEventListener(
				EVENT_CHANGE,
				() => {
					options.state.beatCues = enabled.checked
					this.save()
				},
				{ signal: this.abort.signal }
			)
			label.append(enabled, "Beat cues")
			menu.append(label)
		}
		settings.append(toggle, menu)
		settings.addEventListener(
			EVENT_KEY_DOWN,
			(event) => {
				if (event.key === "Escape" && !menu.hidden) {
					event.stopPropagation()
					closeMenu()
					toggle.focus()
				}
			},
			{ signal: this.abort.signal }
		)
		document.addEventListener(
			EVENT_POINTER_DOWN,
			(event) => {
				if (!settings.contains(event.target as Node)) {
					closeMenu()
				}
			},
			{ signal: this.abort.signal }
		)
		toolbar.append(edit, settings, name, this.vrButton)
		this.status.className = "cs-status"
		this.status.setAttribute("role", "status")
		;(options.toolbarHost ?? this.element).append(toolbar)
		this.sourceKey.className = "cs-source-key"
		this.sourceKey.setAttribute("aria-label", "Control sources")
		this.layoutStatus.className = "cs-sr-only"
		this.layoutStatus.setAttribute("role", "status")
		this.layoutActions.className = "cs-layout-actions"
		this.layoutActions.append(this.button("Auto arrange", () => this.autoArrange()))
		this.element.append(
			this.sourceKey,
			this.playGuide,
			this.layoutActions,
			this.viewport,
			this.pageNavigation,
			this.status,
			this.layoutStatus
		)
		window.addEventListener(EVENT_RESIZE, () => this.layout(), { signal: this.abort.signal })
		this.resize = new ResizeObserver(() => this.layout())
		this.resize.observe(this.element)
		this.intersection = new IntersectionObserver((entries) => {
			this.visible = entries.some((e) => e.isIntersecting)
		})
		this.intersection.observe(this.element)
		const listen = (type: string, listener: EventListener) =>
			this.stage.addEventListener(type, listener, { signal: this.abort.signal })
		listen(EVENT_POINTER_DOWN, (event) => {
			const e = event as PointerEvent
			if ((e.target as HTMLElement).closest("input,select,button,textarea")) {
				return
			}
			const rect = this.stage.getBoundingClientRect()
			this.pointerRect = rect
			this.stageWidth = this.stage.clientWidth || 640
			if (
				this.pointerDown(
					e.pointerId,
					((e.clientX - rect.left) * this.stageWidth) / rect.width,
					((e.clientY - rect.top) * this.height) / rect.height,
					e.shiftKey,
					this.pressure(e)
				)
			) {
				e.preventDefault()
				this.stage.setPointerCapture(e.pointerId)
			}
		})
		listen(EVENT_POINTER_MOVE, (event) => {
			if (!this.gestures.has((event as PointerEvent).pointerId)) {
				return
			}
			const e = event as PointerEvent,
				rect = this.pointerRect ?? this.stage.getBoundingClientRect()
			this.pointerMove(
				e.pointerId,
				((e.clientX - rect.left) * this.stageWidth) / rect.width,
				((e.clientY - rect.top) * this.height) / rect.height,
				e.shiftKey,
				this.pressure(e)
			)
		})
		for (const type of [EVENT_POINTER_UP, EVENT_POINTER_CANCEL, EVENT_LOST_POINTER_CAPTURE]) {
			listen(type, (event) => this.pointerUp((event as PointerEvent).pointerId))
		}
		window.addEventListener(EVENT_BLUR, () => this.releasePointers(), {
			signal: this.abort.signal
		})
		document.addEventListener(
			EVENT_VISIBILITY_CHANGE,
			() => {
				if (document.hidden) {
					this.releasePointers()
				}
			},
			{ signal: this.abort.signal }
		)
		this.rebuild()
		void this.initialize()
		this.poll = window.setInterval(() => void this.refresh(), 160)
		const loop = (time: number) => {
			if (this.disposed) {
				return
			}
			if (this.renderer && this.visible && !document.hidden && !this.xr && !this.enteringXR) {
				try {
					const rect = this.stage.getBoundingClientRect()
					const width = this.stage.clientWidth || 640
					this.pointerRect = rect
					this.stageWidth = width
					const scale = rect.width / width || 1
					const playing = playingLayout(width, Math.min(rect.width, innerWidth))
					if (this.layoutMode !== `${playing.hands}:${playing.columns}`) {
						this.layout()
					}
					this.updateBeat()
					const visible = this.viewport.getBoundingClientRect()
					this.renderer.prepare(
						this.entries
							.filter((e) => e.page === this.currentPage)
							.map((e) => e.visual),
						!this.motion.matches
					)
					this.renderer.render(width, this.height, time / 1000, !this.motion.matches, {
						x: Math.max(0, (Math.max(0, visible.left) - rect.left) / scale),
						y: Math.max(0, (Math.max(0, visible.top) - rect.top) / scale),
						width: Math.max(
							0,
							(Math.min(innerWidth, rect.right, visible.right) -
								Math.max(0, rect.left, visible.left)) /
								scale
						),
						height: Math.max(
							0,
							(Math.min(innerHeight, rect.bottom, visible.bottom) -
								Math.max(0, rect.top, visible.top)) /
								scale
						),
						scale
					})
				} catch (error) {
					void this.gpuError(error instanceof Error ? error : new Error(String(error)))
				}
			}
			// Submit the newest pointer position before invoking engine or DOM work.
			this.flushWrites()
			if (this.visible && !document.hidden && !this.xr) {
				this.updateFeedback()
			}
			this.frame = requestAnimationFrame(loop)
		}
		this.frame = requestAnimationFrame(loop)
	}
	private updateBeat(): void {
		this.renderer?.setBeatPosition(
			!this.motion.matches && this.options.state.beatCues !== false
				? this.options.beatPosition?.()
				: undefined
		)
	}
	private button(label: string, run: () => void): HTMLButtonElement {
		const button = document.createElement("button")
		button.type = "button"
		button.textContent = label
		button.addEventListener(EVENT_CLICK, run, { signal: this.abort.signal })
		return button
	}
	private pressure(event: PointerEvent): number {
		const value = contactPressure(
			event.pressure,
			event.pointerType,
			this.pressurePointers.has(event.pointerId)
		)
		if (value !== undefined) {
			this.pressurePointers.add(event.pointerId)
		}
		return value ?? 1
	}
	private save() {
		const used = new Set(
			this.options.state.widgets.flatMap((w) => (w.yKey ? [w.key, w.yKey] : [w.key]))
		)
		this.options.state.connections = this.options.state.connections
			.map((c) => ({
				...c,
				controlIds: c.controlIds.filter((id) => used.has(bindingKey(c.componentId, id)))
			}))
			.filter((c) => c.controlIds.length)
		this.options.change(structuredClone(this.options.state))
	}
	private async initialize(): Promise<void> {
		try {
			const renderer = await GpuSurfaceRenderer.create(
				this.canvas,
				(error) => void this.gpuError(error)
			)
			if (this.disposed) {
				renderer.destroy()
				return
			}
			this.renderer = renderer
			renderer.setTheme(this.options.state.theme ?? "neon")
			if (this.options.visualEffects) {
				renderer.setVisualEffects(this.options.visualEffects)
			}
			this.element.classList.add("cs-gpu-ready")
		} catch (error) {
			if (!this.disposed) {
				this.status.textContent = String(error)
				this.element.classList.remove("cs-gpu-ready")
			}
		}
	}
	private async gpuError(error: Error): Promise<void> {
		if (this.recovering || this.disposed) {
			return
		}
		this.recovering = true
		this.status.textContent = error.message
		this.element.classList.remove("cs-gpu-ready")
		await this.xr?.end().catch(() => {})
		this.renderer?.destroy()
		this.renderer = undefined
		await this.initialize()
		this.recovering = false
	}
	private rebuild(): void {
		this.releasePointers()
		this.unsubscribers.forEach((fn) => fn())
		this.unsubscribers = []
		for (const entry of this.entries) {
			entry.element.remove()
		}
		this.entries = []
		const bindings = new Map(this.options.bindings.map((b) => [b.key, b]))
		const configurations = this.options.state.widgets
		this.sourceKey.replaceChildren()
		const sources = new Set<string>()
		for (const config of configurations) {
			let binding = bindings.get(config.key)
			if (config.yKey && binding && bindings.has(config.yKey)) {
				const x = binding,
					y = bindings.get(config.yKey)!
				binding = {
					key: bindingKey(x.key, y.key),
					sourceId:
						(x.sourceId ?? x.sourceLabel) === (y.sourceId ?? y.sourceLabel)
							? (x.sourceId ?? x.sourceLabel)
							: bindingKey(x.sourceId ?? x.sourceLabel, y.sourceId ?? y.sourceLabel),
					sourceLabel: `${x.sourceLabel} / ${y.sourceLabel}`,
					descriptor: {
						id: "xy",
						label: `${x.descriptor.label} / ${y.descriptor.label}`,
						widget: "xy",
						min: 0,
						max: 1,
						step: 0.001
					},
					async read() {
						return [
							normalize(x.descriptor, Number(await x.read())),
							normalize(y.descriptor, Number(await y.read()))
						]
					},
					write(value) {
						const v = value as number[]
						const a = x.write(denormalize(x.descriptor, v[0]))
						const b = y.write(denormalize(y.descriptor, v[1]))
						if (a || b) {
							return Promise.all([a, b]).then(() => {})
						}
					},
					subscribe(listener) {
						const a = x.subscribe?.(listener),
							b = y.subscribe?.(listener)
						return () => {
							a?.()
							b?.()
						}
					}
				}
			}
			const unavailable = !binding || (!!config.yKey && !bindings.has(config.yKey))
			binding ??= {
				key: config.key,
				sourceLabel: "Missing component",
				descriptor: {
					id: config.key,
					label: "Unavailable control",
					widget: "display",
					readOnly: true
				},
				read: () => undefined,
				write: () => {}
			}
			const widget = config.yKey
				? "xy"
				: config.widget && widgetChoices(binding.descriptor).includes(config.widget)
					? config.widget
					: binding.descriptor.widget
			const element = document.createElement("div")
			element.className = "cs-widget"
			const sourceId = binding.sourceId ?? binding.sourceLabel
			if (!sources.has(sourceId)) {
				sources.add(sourceId)
				const item = document.createElement("li")
				item.style.setProperty("--cs-source", sourceTheme(sourceId).cssAccent)
				item.textContent = binding.sourceLabel
				this.sourceKey.append(item)
			}
			element.dataset.sourceId = sourceId
			element.style.setProperty("--cs-source", sourceTheme(sourceId).cssAccent)
			element.title = `${binding.sourceLabel}: ${binding.descriptor.label}`
			element.setAttribute("role", "group")
			element.setAttribute("aria-label", element.title)
			element.draggable = this.editing
			element.addEventListener(EVENT_DRAG_START, (event) => {
				;(event as DragEvent).dataTransfer?.setData(
					"application/x-harmoneasy-widget",
					JSON.stringify({
						surface: this.options.state.id,
						index: configurations.indexOf(config)
					})
				)
			})
			element.addEventListener(EVENT_DRAG_OVER, (event) => {
				if (
					this.editing &&
					(event as DragEvent).dataTransfer?.types.includes(
						"application/x-harmoneasy-widget"
					)
				) {
					event.preventDefault()
				}
			})
			element.addEventListener(EVENT_DROP, (event) => {
				if (!this.editing) {
					return
				}
				try {
					const payload = JSON.parse(
							(event as DragEvent).dataTransfer?.getData(
								"application/x-harmoneasy-widget"
							) || "null"
						),
						target = configurations.indexOf(config)
					if (
						payload?.surface !== this.options.state.id ||
						!Number.isInteger(payload.index) ||
						payload.index < 0 ||
						payload.index >= configurations.length
					) {
						return
					}
					event.preventDefault()
					const [moved] = configurations.splice(payload.index, 1)
					configurations.splice(target, 0, moved)
					this.rebuild()
					this.save()
					this.focusLayout(moved, "Drag")
					this.layoutStatus.textContent = `Control moved to position ${target + 1} of ${configurations.length}`
				} catch {
					/* Ignore unrelated drag data. */
				}
			})
			const entry: Entry = {
				config,
				binding,
				element,
				visual: {
					key: binding.key,
					x: 0,
					y: 0,
					width: 0,
					height: 172,
					descriptor: binding.descriptor,
					widget,
					dial:
						widget === "dial" || widget === "rotation"
							? dialOptions({
									...binding.descriptor.dial,
									...config.dial,
									...(widget === "rotation" ? { mode: "rotation" as const } : {})
								})
							: undefined,
					sourceLabel: binding.sourceLabel,
					sourceId,
					value: binding.descriptor.defaultValue,
					unavailable
				},
				update: () => {},
				version: 0,
				busy: false,
				actions: [],
				missing: unavailable,
				reading: false,
				dirty: true,
				semanticDirty: true
			}
			const control = createDomControl(
				{
					...binding,
					descriptor: {
						...binding.descriptor,
						widget,
						dial: entry.visual.dial,
						disabled: unavailable || binding.descriptor.disabled
					}
				},
				(value, edge) => void this.write(entry, value, edge)
			)
			control.element.className = `cs-semantic cs-${widget}`
			control.element.inert = this.editing
			control.element.hidden = this.editing
			entry.release = control.release
			entry.visual.relative = control.relative
			entry.visual.strum = control.strum
			{
				if (widget === "dial" || widget === "rotation") {
					element.tabIndex = -1
				}
				element.addEventListener(EVENT_FOCUS_IN, () => {
					entry.visual.focused = true
				})
				element.addEventListener(EVENT_FOCUS_OUT, (event) => {
					entry.visual.focused =
						event.relatedTarget instanceof Node && element.contains(event.relatedTarget)
				})
			}
			const inputs = control.element.querySelectorAll<
				HTMLInputElement | HTMLSelectElement | HTMLButtonElement
			>("input,select,button")
			entry.update = (value) => {
				control.update(value)
				for (const input of inputs) {
					input.disabled = !!(
						entry.visual.unavailable ||
						entry.binding.descriptor.disabled ||
						entry.binding.descriptor.readOnly
					)
				}
			}
			element.append(control.element)
			if (this.editing) {
				const tools = document.createElement("div")
				tools.className = "cs-widget-tools"
				const kind = document.createElement("select")
				kind.setAttribute("aria-label", `${binding.descriptor.label} widget`)
				for (const type of config.yKey ? ["xy"] : widgetChoices(binding.descriptor)) {
					const option = document.createElement("option")
					option.value = type
					option.textContent = type
					kind.append(option)
				}
				kind.value = widget
				kind.addEventListener(EVENT_CHANGE, () => {
					config.widget = kind.value as SurfaceWidget["widget"]
					this.rebuild()
					this.save()
					this.entries
						.find((item) => item.config === config)
						?.element.querySelector<HTMLSelectElement>(".cs-widget-tools select")
						?.focus()
				})
				const move = (offset: number) => {
					const i = configurations.indexOf(config),
						j = i + offset
					if (j < 0 || j >= configurations.length) {
						return
					}
					;[configurations[i], configurations[j]] = [configurations[j], configurations[i]]
					delete config.column
					this.rebuild()
					this.save()
					this.focusLayout(config, offset < 0 ? "Move earlier" : "Move later")
					this.layoutStatus.textContent = `${binding.descriptor.label} moved to position ${j + 1} of ${configurations.length}`
				}
				tools.append(
					kind,
					this.button("Move earlier", () => move(-1)),
					this.button("Move later", () => move(1)),
					this.button("Rotate", () => {
						config.rotation = (((config.rotation ?? 0) + 90) %
							360) as SurfaceWidget["rotation"]
						this.layout()
						this.save()
						this.layoutStatus.textContent = `${binding.descriptor.label} rotated to ${config.rotation} degrees`
					}),
					this.button("Remove", () => {
						const index = configurations.indexOf(config)
						configurations.splice(index, 1)
						this.rebuild()
						this.save()
						const next = configurations[Math.min(index, configurations.length - 1)]
						if (next) {
							this.focusLayout(next, "Remove")
						} else {
							this.toolbar.querySelector<HTMLButtonElement>("button")?.focus()
						}
						this.layoutStatus.textContent = `${binding.descriptor.label} removed`
					})
				)
				for (const button of tools.querySelectorAll("button")) {
					button.setAttribute(
						"aria-label",
						`${button.textContent} ${binding.descriptor.label}`
					)
				}
				const resize = this.button("Resize", () => this.resizeDialog(entry))
				resize.setAttribute("aria-label", `Resize ${binding.descriptor.label}`)
				resize.setAttribute(
					"aria-description",
					"Drag to resize. Left and right change width; up and down change height."
				)
				resize.addEventListener(EVENT_KEY_DOWN, (event) => {
					if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
						return
					}
					event.preventDefault()
					this.resizeWidget(
						entry,
						(config.span ?? (largeWidget(widget) ? 2 : 1)) +
							(event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0),
						(entry.config.rotation === 90 || entry.config.rotation === 270
							? entry.visual.width
							: entry.visual.height) +
							(event.key === "ArrowDown" ? 24 : event.key === "ArrowUp" ? -24 : 0)
					)
					this.save()
				})
				const drag = this.button("Move", () => {})
				drag.setAttribute("aria-label", `Drag ${binding.descriptor.label}`)
				drag.setAttribute(
					"aria-description",
					"Drag to another position. Use Move earlier or Move later for keyboard or single-click sorting."
				)
				this.layoutHandle(drag, entry, false)
				this.layoutHandle(resize, entry, true)
				tools.prepend(drag)
				tools.append(resize)
				entry.tools = toolPages(tools, binding.descriptor.label)
				element.append(tools)
			}
			this.entries.push(entry)
			this.stage.append(element)
			this.unsubscribers.push(
				binding.subscribe?.(() => {
					entry.dirty = true
				}) ?? (() => {})
			)
		}
		this.element.classList.toggle("cs-editing", this.editing)
		this.layoutActions.hidden = !this.editing
		this.status.textContent = this.entries.length
			? ""
			: "Drag a component’s Controls connector here to choose controls."
		this.layout()
		void this.refresh()
	}
	private resizeDialog(entry: Entry): void {
		const dialog = document.createElement("dialog"),
			form = document.createElement("form"),
			heading = document.createElement("h3")
		dialog.className = "cs-size-dialog"
		dialog.addEventListener(EVENT_KEY_DOWN, (event) => event.stopPropagation())
		dialog.setAttribute("aria-label", `${entry.binding.descriptor.label} size`)
		heading.textContent = `Resize ${entry.binding.descriptor.label}`
		const width = document.createElement("select"),
			height = document.createElement("input")
		const column = document.createElement("select"),
			automatic = document.createElement("option")
		automatic.value = ""
		automatic.textContent = "Automatic"
		column.append(automatic)
		for (
			let i = 0;
			i <
			playingLayout(
				this.stage.clientWidth || 640,
				this.stage.getBoundingClientRect().width || 640
			).columns;
			i++
		) {
			const option = document.createElement("option")
			option.value = String(i)
			option.textContent = String(i + 1)
			column.append(option)
		}
		column.value = entry.config.column === undefined ? "" : String(entry.config.column)
		for (let i = 1; i <= 3; i++) {
			const option = document.createElement("option")
			option.value = String(i)
			option.textContent = `${i} column${i === 1 ? "" : "s"}`
			width.append(option)
		}
		width.value = String(entry.config.span ?? (largeWidget(entry.visual.widget) ? 2 : 1))
		height.type = "number"
		height.min = "132"
		height.max = "720"
		height.step = "1"
		height.required = true
		height.value = String(
			entry.config.rotation === 90 || entry.config.rotation === 270
				? entry.visual.width
				: entry.visual.height
		)
		for (const [title, input] of [
			["Width", width],
			["Height in pixels", height],
			["Preferred column", column]
		] as const) {
			const label = document.createElement("label")
			label.append(title, input)
			form.append(label)
		}
		const shorter = this.button(
			"Decrease height",
			() => (height.value = String(Math.max(132, (height.valueAsNumber || 132) - 24)))
		)
		const taller = this.button(
			"Increase height",
			() => (height.value = String(Math.min(720, (height.valueAsNumber || 132) + 24)))
		)
		const apply = document.createElement("button")
		apply.type = "submit"
		apply.textContent = "Apply size"
		form.append(
			shorter,
			taller,
			apply,
			this.button("Cancel", () => dialog.close())
		)
		form.addEventListener(EVENT_SUBMIT, (event) => {
			event.preventDefault()
			if (!form.reportValidity()) {
				return
			}
			this.resizeWidget(entry, Number(width.value), height.valueAsNumber)
			if (column.value === "") {
				delete entry.config.column
			} else {
				entry.config.column = Number(column.value)
			}
			this.layout()
			this.save()
			dialog.close()
		})
		dialog.append(heading, form)
		document.body.append(dialog)
		dialog.addEventListener(
			EVENT_CLOSE,
			() => {
				dialog.remove()
				this.focusLayout(entry.config, "Resize")
			},
			{ once: true }
		)
		this.abort.signal.addEventListener(EVENT_ABORT, () => dialog.close(), { once: true })
		dialog.showModal()
	}
	private focusLayout(config: SurfaceWidget, action: string): void {
		const entry = this.entries.find((item) => item.config === config)
		if (!entry) {
			return
		}
		this.showPage(entry.page ?? 0)
		const button = Array.from(entry.element.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) =>
				button.getAttribute("aria-label") === `${action} ${entry.binding.descriptor.label}`
		)
		if (button) {
			entry.tools?.reveal(button)
			button.focus({ preventScroll: true })
		}
	}
	private resizeWidget(entry: Entry, span: number, height: number): void {
		entry.config.span = Math.max(1, Math.min(3, Math.round(span)))
		entry.config.height = Math.max(132, Math.min(720, Math.round(height)))
		this.layout()
		this.layoutStatus.textContent = `${entry.binding.descriptor.label}: width ${entry.config.span}, height ${entry.config.height} pixels`
	}
	private layoutHandle(handle: HTMLButtonElement, entry: Entry, resizing: boolean): void {
		handle.classList.add("cs-layout-handle")
		let moved = false,
			skipClick = false
		handle.addEventListener(
			EVENT_CLICK,
			(event) => {
				if (skipClick) {
					event.preventDefault()
					event.stopImmediatePropagation()
					skipClick = false
				}
			},
			{ capture: true }
		)
		handle.addEventListener(EVENT_KEY_DOWN, () => {
			skipClick = false
		})
		let start:
			| { id: number; x: number; y: number; span: number; height: number; scale: number }
			| undefined
		handle.addEventListener(EVENT_POINTER_DOWN, (event) => {
			if (event.button !== 0 || start) {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			handle.focus()
			moved = false
			skipClick = false
			handle.setPointerCapture(event.pointerId)
			start = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				span: entry.config.span ?? (largeWidget(entry.visual.widget) ? 2 : 1),
				height:
					entry.config.rotation === 90 || entry.config.rotation === 270
						? entry.visual.width
						: entry.visual.height,
				scale:
					this.stage.getBoundingClientRect().width / (this.stage.clientWidth || 640) || 1
			}
		})
		handle.addEventListener(EVENT_POINTER_MOVE, (event) => {
			if (!start || event.pointerId !== start.id) {
				return
			}
			moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3
			event.stopPropagation()
			if (resizing) {
				const width = this.stage.clientWidth || 640,
					profile = playingLayout(
						width,
						this.stage.getBoundingClientRect().width || width
					),
					cell = (width - profile.gutter) / profile.columns
				this.resizeWidget(
					entry,
					start.span + (event.clientX - start.x) / (cell * start.scale),
					start.height + (event.clientY - start.y) / start.scale
				)
			} else {
				let closest: Entry | undefined,
					distance = Infinity
				for (const target of this.entries) {
					if (target === entry || target.page !== this.currentPage) {
						continue
					}
					const rect = target.element.getBoundingClientRect(),
						next = Math.hypot(
							event.clientX - rect.left - rect.width / 2,
							event.clientY - rect.top - rect.height / 2
						)
					if (next < distance) {
						distance = next
						closest = target
					}
				}
				this.entries.forEach((target) =>
					target.element.classList.toggle("cs-drop-target", target === closest)
				)
			}
		})
		const finish = (event: PointerEvent) => {
			if (!start || event.pointerId !== start.id) {
				return
			}
			const initial = start
			start = undefined
			skipClick = moved
			if (event.type === EVENT_POINTER_UP) {
				if (!resizing && moved) {
					const target = this.entries.find((candidate) =>
						candidate.element.classList.contains("cs-drop-target")
					)
					const stage = this.stage.getBoundingClientRect(),
						width = this.stage.clientWidth || 640,
						profile = playingLayout(width, stage.width || width),
						columns = profile.columns,
						px = ((event.clientX - stage.left) / stage.width) * width
					entry.config.column = Math.max(
						0,
						Math.min(
							columns - 1,
							Math.floor(
								(px -
									(profile.hands === 2 && px > width / 2 ? profile.gutter : 0)) /
									((width - profile.gutter) / columns)
							)
						)
					)
					if (target && target !== entry) {
						const widgets = this.options.state.widgets,
							from = widgets.indexOf(entry.config)
						widgets.splice(from, 1)
						const targetRect = target.element.getBoundingClientRect()
						const to =
							widgets.indexOf(target.config) +
							(event.clientY >= targetRect.top + targetRect.height / 2 ? 1 : 0)
						widgets.splice(to, 0, entry.config)
						this.rebuild()
						this.focusLayout(entry.config, "Drag")
						this.layoutStatus.textContent = `${entry.binding.descriptor.label} moved to position ${to + 1} of ${widgets.length}`
					} else {
						this.layout()
						this.layoutStatus.textContent = `${entry.binding.descriptor.label} moved to column ${entry.config.column + 1}`
					}
				}
				this.save()
			} else if (resizing) {
				this.resizeWidget(entry, initial.span, initial.height)
			}
			this.entries.forEach((candidate) =>
				candidate.element.classList.remove("cs-drop-target")
			)
		}
		for (const name of [EVENT_POINTER_UP, EVENT_POINTER_CANCEL, EVENT_LOST_POINTER_CAPTURE]) {
			handle.addEventListener(name, (event) => finish(event as PointerEvent))
		}
	}
	private layoutItems() {
		return this.entries.map((e) => ({
			...e.config,
			sourceId: e.binding.sourceId ?? e.binding.sourceLabel,
			group: e.binding.descriptor.group,
			widget: e.visual.widget,
			span: e.config.span ?? (largeWidget(e.visual.widget) ? 2 : 1),
			height:
				e.config.height ??
				(isMusicGrid(e.visual.widget)
					? Math.max(
							250,
							musicOptions(e.visual.widget, e.binding.descriptor.music).pitches
								.length *
								24 +
								46
						)
					: largeWidget(e.visual.widget)
						? 280
						: 172)
		}))
	}
	private autoArrange(): void {
		const order = ergonomicOrder(
			this.layoutItems(),
			this.stage.clientWidth || 640,
			Math.min(this.stage.getBoundingClientRect().width || 640, innerWidth),
			this.pageHeight
		)
		this.options.state.widgets = order.map((index) => this.entries[index].config)
		this.options.state.widgets.forEach((widget) => {
			delete widget.column
		})
		this.rebuild()
		this.save()
		this.layoutStatus.textContent =
			"Layout arranged to reduce empty space and keep related controls together"
	}
	private layout(): void {
		this.pointerRect = undefined
		const width = this.stage.clientWidth || 640,
			screenWidth = Math.min(this.stage.getBoundingClientRect().width || width, innerWidth),
			profile = playingLayout(width, screenWidth)
		const mode = `${profile.hands}:${profile.columns}`
		if (mode !== this.layoutMode) {
			this.playGuide.textContent =
				profile.hands === 2
					? "Two-hand layout · left and right playing zones"
					: "One-hand layout · compact playing zone"
			this.layoutMode = mode
		}
		this.element.dataset.hands = String(profile.hands)
		const stageRect = this.stage.getBoundingClientRect()
		const scale = stageRect.width / width || 1
		// Reserve footer space even on a single page so pagination cannot change its own capacity.
		this.pageHeight = Math.max(
			1,
			Math.min(
				(innerHeight * 0.72) / scale,
				(innerHeight - Math.max(0, stageRect.top) - 90 * scale) / scale
			)
		)
		this.element.style.setProperty("--cs-target", `${44 / scale}px`)
		this.element.style.setProperty("--cs-gap", `${11 / scale}px`)
		this.element.style.setProperty("--cs-pager", `${55 / scale}px`)
		this.toolbar.style.setProperty("--cs-target", `${44 / scale}px`)
		this.toolbar.style.setProperty("--cs-gap", `${11 / scale}px`)
		const layout = layoutWidgets(this.layoutItems(), width, screenWidth, this.pageHeight, scale)
		this.pageCount = layout.pages
		this.currentPage = Math.min(this.currentPage, this.pageCount - 1)
		this.height = layout.height
		this.stage.style.height = `${this.height}px`
		for (const [index, entry] of this.entries.entries()) {
			const box = layout.items[index],
				rotation = entry.config.rotation ?? 0,
				sideways = rotation === 90 || rotation === 270
			Object.assign(
				entry.visual,
				sideways
					? {
							x: box.x + (box.width - box.height) / 2,
							y: box.y + (box.height - box.width) / 2,
							width: box.height,
							height: box.width,
							rotation
						}
					: { ...box, rotation }
			)
			entry.page = box.page
			const r = entry.visual
			entry.tools?.resize(r.width - 6, r.height - 4, scale)
			const grid = entry.element.querySelector<HTMLElement>(".cs-note-grid")
			if (grid) {
				r.musicView = resizeMusicGrid(grid, r.width, r.height, scale)
			}
			if (r.relative) {
				const rect = relativeRect(r.width, r.height)
				r.relative.minimumKeySize = 55 / scale
				r.relative.width = rect.width
				r.relative.height = rect.height
			}
			Object.assign(entry.element.style, {
				left: `${r.x}px`,
				top: `${r.y}px`,
				width: `${r.width}px`,
				height: `${r.height}px`,
				transform: `rotate(${rotation}deg)`
			})
		}
		this.updatePage()
	}
	/** Select a gadget page without moving the surface or scrolling its contents. */
	showPage(index: number): void {
		const page = Math.max(0, Math.min(this.pageCount - 1, Math.floor(index)))
		if (page !== this.currentPage) {
			this.releasePointers()
			this.currentPage = page
		}
		this.updatePage()
	}
	private updatePage(): void {
		for (const entry of this.entries) {
			const hidden = entry.page !== this.currentPage
			if (hidden && !entry.element.hidden) {
				for (const [id, gesture] of this.gestures) {
					if (gesture.entry === entry) {
						this.pointerUp(id)
					}
				}
				entry.release?.()
				if (entry.element.contains(document.activeElement)) {
					this.viewport.focus({ preventScroll: true })
				}
			}
			entry.element.hidden = hidden
			entry.element.inert = hidden
		}
		this.previousPage.disabled = this.currentPage === 0
		this.nextPage.disabled = this.currentPage === this.pageCount - 1
		this.pageLabel.textContent = `Page ${this.currentPage + 1} of ${this.pageCount}`
		this.viewport.setAttribute(
			"aria-label",
			`Control gadgets, page ${this.currentPage + 1} of ${this.pageCount}`
		)
	}

	private refresh(): void {
		for (const entry of this.entries) {
			entry.dirty = true
		}
		if (this.visible && !document.hidden) {
			this.updateFeedback()
		}
	}
	private updateFeedback(): void {
		for (const entry of this.entries) {
			if (entry.semanticDirty) {
				entry.update(entry.visual.value)
				entry.semanticDirty = false
			}
			if (
				(!entry.dirty && entry.visual.widget !== "meter") ||
				entry.reading ||
				entry.busy ||
				entry.pending !== undefined ||
				entry.actions.length > 0 ||
				entry.visual.active ||
				entry.missing
			) {
				continue
			}
			entry.dirty = false
			entry.reading = true
			const version = entry.version
			const accept = (value: ControlValue | undefined) => {
				if (
					this.disposed ||
					version !== entry.version ||
					entry.busy ||
					entry.pending !== undefined ||
					entry.visual.active
				) {
					return
				}
				const unavailable = value === undefined && entry.visual.widget !== "button"
				if (
					!sameValue(value, entry.visual.value) ||
					unavailable !== entry.visual.unavailable
				) {
					entry.visual.value = value
					entry.visual.unavailable = unavailable
					entry.semanticDirty = true
				}
			}
			const failed = () => {
				if (
					this.disposed ||
					version !== entry.version ||
					entry.busy ||
					entry.pending !== undefined ||
					entry.visual.active
				) {
					return
				}
				entry.visual.unavailable = true
				entry.semanticDirty = true
			}
			try {
				const value = entry.binding.read()
				if (value instanceof Promise) {
					void value.then(accept, failed).finally(() => {
						entry.reading = false
					})
				} else {
					accept(value)
					entry.reading = false
				}
			} catch {
				failed()
				entry.reading = false
			}
		}
	}
	private write(entry: Entry, value: ControlValue, edge = false): void {
		if (entry.visual.unavailable) {
			return
		}
		try {
			value = validateValue(
				{ ...entry.binding.descriptor, widget: entry.visual.widget },
				value
			)
		} catch (error) {
			this.status.textContent = String(error)
			return
		}
		const padEdge =
			entry.visual.widget === "pad" &&
			(edge ||
				normalize(entry.binding.descriptor, Number(entry.visual.value)) > 0 !==
					normalize(entry.binding.descriptor, Number(value)) > 0)
		const relativeEdge =
			(entry.visual.widget === "relative-keys" ||
				entry.visual.widget === "strum" ||
				(isMusicGrid(entry.visual.widget) && entry.binding.descriptor.music?.live)) &&
			edge
		entry.visual.value = value
		if (entry.visual.widget === "pad") {
			entry.visual.active = normalize(entry.binding.descriptor, Number(value)) > 0
		}
		if (entry.visual.widget === "relative-keys") {
			entry.visual.active = !!entry.visual.relative?.contacts.size
		}
		if (entry.visual.widget === "strum") {
			entry.visual.active = !!entry.visual.strum?.contacts.size
		}
		entry.semanticDirty = true
		if (entry.visual.widget === "button" || padEdge || relativeEdge) {
			if (padEdge || relativeEdge) {
				entry.pending = undefined
			}
			entry.actions.push(value)
		} else {
			entry.pending = value
		}
		entry.version++
		if (
			entry.visual.widget === "button" ||
			padEdge ||
			relativeEdge ||
			![
				"dial",
				"rotation",
				"slider",
				"number",
				"xy",
				"range",
				"pad",
				"relative-keys",
				"strum"
			].includes(entry.visual.widget)
		) {
			void this.flushEntry(entry)
		}
	}
	private flushWrites(): void {
		for (const entry of this.entries) {
			if (entry.pending !== undefined || entry.actions.length) {
				void this.flushEntry(entry)
			}
		}
	}
	private async flushEntry(entry: Entry): Promise<void> {
		if (entry.busy) {
			return
		}
		entry.busy = true
		try {
			do {
				const action = entry.actions.length > 0
				const next = action ? entry.actions.shift()! : entry.pending!
				if (!action) {
					entry.pending = undefined
				}
				const result = entry.binding.write(next)
				if (result) {
					await result
				}
			} while (
				entry.actions.length &&
				(!this.disposed ||
					entry.visual.widget === "pad" ||
					entry.visual.widget === "relative-keys" ||
					entry.visual.widget === "strum")
			)
			this.status.textContent = ""
			this.options.configurationChanged?.()
		} catch (error) {
			this.status.textContent = String(error)
			entry.pending = undefined
			entry.actions = []
		} finally {
			entry.busy = false
		}
	}
	/** Local surface coordinates also accept projected XR rays/hand positions. */
	pointerDown(id: number, x: number, y: number, fine = false, pressure = 1): boolean {
		const entry = this.entries.find((e) => {
			if (e.page !== this.currentPage) {
				return false
			}
			const point = widgetPoint(x, y, e.visual)
			return (
				point.x >= e.visual.x &&
				point.x <= e.visual.x + e.visual.width &&
				point.y >= e.visual.y &&
				point.y <= e.visual.y + e.visual.height
			)
		})
		if (
			!entry ||
			this.editing ||
			entry.visual.unavailable ||
			entry.binding.descriptor.disabled ||
			entry.binding.descriptor.readOnly ||
			["text", "color", "meter", "display"].includes(entry.visual.widget)
		) {
			return false
		}
		const value = entry.visual.value
		const originalX = x,
			originalY = y
		;({ x, y } = widgetPoint(x, y, entry.visual))
		if (entry.visual.relative || entry.visual.strum) {
			const rect = relativeRect(entry.visual.width, entry.visual.height)
			this.gestures.set(id, {
				entry,
				startY: y,
				startValue: 0,
				axis: 0,
				pressure,
				position: 0
			})
			const controller = (entry.visual.relative ?? entry.visual.strum)!
			controller.down(
				id,
				clamp((x - entry.visual.x - rect.x) / rect.width),
				clamp((y - entry.visual.y - rect.y) / rect.height),
				pressure
			)
			return true
		}
		if (isMusicGrid(entry.visual.widget)) {
			const d = entry.binding.descriptor,
				options = musicOptions(entry.visual.widget, d.music),
				rect = musicRect(
					entry.visual.width,
					entry.visual.height,
					11 / (entry.visual.musicView?.gap ?? 11)
				)
			const px = x - entry.visual.x - rect.x,
				py = y - entry.visual.y - rect.y
			if (px < 0 || py < 0 || px >= rect.width || py >= rect.height) {
				return false
			}
			const view = entry.visual.musicView ?? {
				row: 0,
				column: 0,
				rows: options.pitches.length,
				columns: options.steps,
				gap: 11
			}
			const rows = Math.min(view.rows, options.pitches.length - view.row),
				columns = Math.min(view.columns, options.steps - view.column)
			const cw = (rect.width + view.gap) / columns,
				ch = (rect.height + view.gap) / rows
			if (px % cw >= cw - view.gap || py % ch >= ch - view.gap) {
				return false
			}
			const index =
				(view.row + Math.floor(py / ch)) * options.steps + view.column + Math.floor(px / cw)
			const values = musicValues(d, value),
				tab = entry.visual.widget === "guitar-tab"
			values[index] = (tab ? values[index] >= 0 : values[index] > 0)
				? tab
					? -1
					: 0
				: tab
					? 0
					: clamp(pressure)
			this.write(entry, values, true)
			return true
		}
		if (entry.visual.widget === "dial" || entry.visual.widget === "rotation") {
			entry.element.focus({ preventScroll: true })
		}
		const axis =
			entry.visual.widget === "range" && Array.isArray(value)
				? Number(
						Math.abs(
							normalize(entry.binding.descriptor, value[0]) -
								(x - entry.visual.x) / entry.visual.width
						) >
							Math.abs(
								normalize(entry.binding.descriptor, value[1]) -
									(x - entry.visual.x) / entry.visual.width
							)
					)
				: 0
		this.gestures.set(id, {
			entry,
			startY: y,
			startValue: normalize(entry.binding.descriptor, Number(value)),
			axis,
			pressure: clamp(pressure),
			position: normalize(entry.binding.descriptor, Number(value)),
			angle:
				Math.hypot(
					x - entry.visual.x - entry.visual.width / 2,
					y - entry.visual.y - 48 - (entry.visual.height - 76) / 2
				) >= 6
					? Math.atan2(
							x - entry.visual.x - entry.visual.width / 2,
							-(y - entry.visual.y - 48 - (entry.visual.height - 76) / 2)
						)
					: undefined
		})
		entry.visual.active = true
		if (entry.visual.widget === "pad") {
			this.updatePad(entry, true)
		} else if (entry.visual.widget === "button") {
			void this.write(entry, entry.binding.descriptor.defaultValue ?? 1)
		} else if (entry.visual.widget === "toggle") {
			void this.write(entry, !value)
		} else if (entry.visual.widget === "select" && entry.binding.descriptor.choices?.length) {
			const choices = entry.binding.descriptor.choices,
				index = choices.findIndex((c) => sameValue(c.value, value))
			void this.write(entry, choices[(index + 1) % choices.length].value)
		} else {
			this.pointerMove(id, originalX, originalY, fine)
		}
		return true
	}
	pointerMove(id: number, x: number, y: number, fine = false, pressure = 1): void {
		const gesture = this.gestures.get(id)
		if (!gesture) {
			return
		}
		if (gesture.entry.visual.widget === "pad") {
			gesture.pressure = clamp(pressure)
			this.updatePad(gesture.entry)
			return
		}
		if (gesture.entry.visual.relative || gesture.entry.visual.strum) {
			const v = gesture.entry.visual,
				point = widgetPoint(x, y, v),
				rect = relativeRect(v.width, v.height)
			const controller = (v.relative ?? v.strum)!
			controller.move(
				id,
				clamp((point.x - v.x - rect.x) / rect.width),
				clamp((point.y - v.y - rect.y) / rect.height),
				pressure
			)
			return
		}
		const { entry } = gesture,
			{
				visual: v,
				binding: { descriptor: d }
			} = entry
		;({ x, y } = widgetPoint(x, y, v))
		const px = clamp((x - v.x - 8 - v.width * 0.08) / (v.width * 0.84 - 16)),
			py = clamp(1 - (y - v.y - 22 - (v.height - 24) * 0.08) / ((v.height - 24) * 0.84))
		if (v.widget === "dial" || v.widget === "rotation") {
			const settings = dialOptions(v.dial)
			const direction = settings.reverse ? -1 : 1
			if (settings.input === "angular") {
				const dx = x - v.x - v.width / 2,
					dy = y - v.y - 48 - (v.height - 76) / 2
				if (Math.hypot(dx, dy) < 6) {
					gesture.angle = undefined
					return
				}
				const angle = Math.atan2(dx, -dy)
				if (gesture.angle !== undefined) {
					const delta = Math.atan2(
						Math.sin(angle - gesture.angle),
						Math.cos(angle - gesture.angle)
					)
					gesture.position +=
						((delta / ((settings.sweepAngle * Math.PI) / 180)) * direction) /
						(fine ? 10 : 1)
				}
				gesture.angle = angle
			} else {
				gesture.position += ((gesture.startY - y) / (fine ? 1600 : 160)) * direction
				gesture.startY = y
			}
			gesture.position =
				settings.mode === "rotation"
					? ((gesture.position % 1) + 1) % 1
					: clamp(gesture.position)
			void this.write(entry, denormalize(d, dialPosition(gesture.position, settings)))
		} else if (v.widget === "number") {
			void this.write(
				entry,
				denormalize(d, gesture.startValue + (gesture.startY - y) / (fine ? 1600 : 160))
			)
		} else if (v.widget === "slider") {
			void this.write(entry, denormalize(d, px))
		} else if (v.widget === "xy") {
			void this.write(entry, [denormalize(d, px), denormalize(d, py)])
		} else if (v.widget === "range") {
			const values = Array.isArray(v.value) ? [...v.value] : [d.min ?? 0, d.max ?? 1]
			values[gesture.axis] = denormalize(d, px)
			void this.write(entry, values)
		} else if (v.widget === "radio" && d.choices?.length) {
			void this.write(
				entry,
				d.choices[
					Math.min(
						d.choices.length - 1,
						Math.floor(clamp((x - v.x - 8) / (v.width - 16)) * d.choices.length)
					)
				].value
			)
		}
	}
	pointerUp(id: number): void {
		const gesture = this.gestures.get(id)
		this.gestures.delete(id)
		this.pressurePointers.delete(id)
		if (gesture) {
			if (gesture.entry.visual.relative || gesture.entry.visual.strum) {
				;(gesture.entry.visual.relative ?? gesture.entry.visual.strum)!.up(id)
				gesture.entry.visual.active = !!(gesture.entry.visual.relative ??
					gesture.entry.visual.strum)!.contacts.size
				return
			}
			if (gesture.entry.visual.widget === "pad") {
				this.updatePad(
					gesture.entry,
					![...this.gestures.values()].some((g) => g.entry === gesture.entry)
				)
				return
			}
			gesture.entry.visual.active = [...this.gestures.values()].some(
				(g) => g.entry === gesture.entry
			)
			// Commit the final value even when a drag ends between animation frames.
			if (gesture.entry.pending !== undefined) {
				void this.flushEntry(gesture.entry)
			}
		}
	}
	private updatePad(entry: Entry, edge = false): void {
		let pressure = 0
		for (const gesture of this.gestures.values()) {
			if (gesture.entry === entry) {
				pressure = Math.max(pressure, gesture.pressure)
			}
		}
		const value = denormalize(entry.binding.descriptor, pressure)
		if (edge || !sameValue(value, entry.visual.value)) {
			void this.write(entry, value, edge)
		}
		entry.visual.active = pressure > 0
	}
	private releasePointers(): void {
		for (const id of this.gestures.keys()) {
			this.pointerUp(id)
		}
		for (const entry of this.entries) {
			entry.release?.()
		}
	}
	private addXY(): void {
		const numeric = this.options.bindings.filter(
			(b) =>
				["dial", "slider", "number"].includes(b.descriptor.widget) && !b.descriptor.readOnly
		)
		const dialog = document.createElement("dialog"),
			form = document.createElement("form"),
			title = document.createElement("h2")
		title.textContent = "Add an XY pad"
		form.method = "dialog"
		form.append(title)
		const selects = ["X parameter", "Y parameter"].map((text) => {
			const label = document.createElement("label"),
				select = document.createElement("select")
			label.append(text, select)
			for (const b of numeric) {
				const o = document.createElement("option")
				o.value = b.key
				o.textContent = `${b.sourceLabel}: ${b.descriptor.label}`
				select.append(o)
			}
			form.append(label)
			return select
		})
		const add = this.button("Add", () => {
			const [x, y] = selects.map((s) => s.value)
			if (!x || !y || x === y) {
				return
			}
			this.options.state.widgets.push({ key: x, yKey: y, widget: "xy", span: 2 })
			this.rebuild()
			this.save()
			dialog.close()
		})
		add.disabled = numeric.length < 2
		if (numeric.length > 1) {
			selects[1].selectedIndex = 1
		}
		form.append(
			add,
			this.button("Cancel", () => dialog.close())
		)
		dialog.append(form)
		document.body.append(dialog)
		dialog.addEventListener(EVENT_CLOSE, () => dialog.remove(), { once: true })
		this.abort.signal.addEventListener(EVENT_ABORT, () => dialog.close(), { once: true })
		dialog.showModal()
	}
	private async enterXR(): Promise<void> {
		if (this.enteringXR) {
			return
		}
		if (this.xr) {
			await this.xr.end()
			return
		}
		if (!this.renderer) {
			this.status.textContent = "WebGPU must be available before entering VR."
			return
		}
		this.enteringXR = true
		try {
			const { startSurfaceXR } = await import("./xr")
			this.xr = await startSurfaceXR(
				this.renderer,
				() => {
					this.updateBeat()
					this.flushWrites()
					this.updateFeedback()
					return {
						widgets: this.entries
							.filter((e) => e.page === this.currentPage)
							.map((e) => e.visual),
						width: this.stage.clientWidth,
						height: this.height
					}
				},
				this,
				() => {
					this.xr = undefined
					this.vrButton.textContent = "Enter VR"
					this.releasePointers()
				},
				(error) => {
					this.status.textContent = String(error)
				}
			)
			if (this.disposed) {
				await this.xr.end()
				this.xr = undefined
				return
			}
			this.vrButton.textContent = "Exit VR"
		} catch (error) {
			this.status.textContent = String(error)
		} finally {
			this.enteringXR = false
		}
	}
	setVisualEffects(options: SurfaceVisualEffects): void {
		const effects = { ...this.options.visualEffects, ...options }
		this.renderer?.setVisualEffects(effects)
		this.options.visualEffects = effects
	}
	async setEffect(wgsl: string): Promise<void> {
		if (!this.renderer) {
			throw new Error("WebGPU is unavailable")
		}
		await this.renderer.setEffect(wgsl)
	}
	async setPostEffect(wgsl: string): Promise<void> {
		if (!this.renderer) {
			throw new Error("WebGPU is unavailable")
		}
		await this.renderer.setPostEffect(wgsl)
	}
	destroy(): void {
		if (this.disposed) {
			return
		}
		for (const entry of this.entries) {
			if (entry.visual.widget === "pad") {
				entry.pending = undefined
				entry.actions = []
			}
		}
		this.releasePointers()
		this.disposed = true
		this.abort.abort()
		this.unsubscribers.forEach((fn) => fn())
		this.resize.disconnect()
		this.intersection.disconnect()
		clearInterval(this.poll)
		cancelAnimationFrame(this.frame)
		void this.xr?.end().catch(() => {})
		this.renderer?.destroy()
		this.toolbar.remove()
		this.element.remove()
	}
}