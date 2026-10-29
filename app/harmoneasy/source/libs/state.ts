/**
 * This is a simple way to pass state from between pages without storing locally
 * bypassing the need for cookies or local storage or GDPR cookie messages.
 */
import { addToHistory, createStateURL, getLocationSettings } from "./location.ts"

const state: Record<string, unknown> = {}
let main: HTMLElement | null = null

/**
 * Adds classnames to the main element to indicate the current state
 */
const setUIState = (key: any, value: any) => {
	// FIXME: filter these?
	main?.classList.toggle(`flag-${key}`, Boolean(value))
}

/**
 * Instantiates the state object
 * @param {String} key Optional key to specify return
 * @returns {Object} current state
 */
export const getState = (key?: string) => {
	return key ? state[key] : state
}

export const setElementCheckState = (element: HTMLElement | string | null, value: unknown) => {
	const target =
		typeof element === "string" ? document.querySelector<HTMLElement>(element) : element
	if (!target) {
		return false
	}
	if (target.parentElement?.nodeName === "LABEL") {
		target.parentElement.classList.toggle("checked", Boolean(value))
	}
	if (target instanceof HTMLInputElement) {
		target.checked = Boolean(value)
	} else if (target instanceof HTMLSelectElement) {
		if (typeof value === "number") {
			target.selectedIndex = value
		} else {
			target.value = String(value)
		}
	}
	return true
}

/**
 * setState : set / store the state of the ui & update DOM
 * Allows you to set the state of the ui by passing in
 * individual options in key value pairs.
 * This is used in realtime button actions for example
 * @param {String} key state unique key ID
 * @param {String} value value to set the key to
 * @param {Array<HTMLElement>} elements buttons with toggleable attributes
 * @param {Boolean} saveHistory add to localStorage cache
 * @returns {Object} current state
 */
export const setState = (
	key: string,
	value: unknown,
	elements: Record<string, HTMLElement> | null = null,
	saveHistory = true,
	repaint = true
) => {
	state[key] = value

	if (saveHistory) {
		addToHistory(state, String(key))
	}

	if (repaint) {
		// set flag on main
		setUIState(key, value)
	}

	// NB. only send elements where the element itself wasnt
	// responsible for the origin of the event

	// also update select for checked and things? bit more complex?
	// see if there is a matching dom element???
	if (elements) {
		setElementCheckState(elements[key], value)
	}

	return state
}

// FIXME: Optimise this...
// TODO: Batch state setting...
export const setStates = (
	states: { key: any; value: any }[],
	_key: any,
	_value: any,
	_elements = null,
	_saveHistory = true
) => {
	states.map(({ key, value }) => setUIState(key, value))
}

// TODO: Make a wrapper createStateStack
// stack.setState( "advancedMode", advancedMode )
export const EVENT_STATE_CHANGE = "global-state-change"

const hasNavigationOccurred = "state" in window.history && window.history.state !== null

/**
 * If you need to observe state changes, use this class
 * and pass around using singelton pattern.
 * This will automatically read existing state from URL
 * and also any mutations
 */
export default class State {
	/**
	 * Use this to get the singleton instance
	 */
	static instance: State
	static getInstance(element: HTMLElement | null) {
		if (!State.instance) {
			State.instance = new State(element)
		}
		return State.instance
	}

	// set the element to somewhere
	element: HTMLElement | null = null

	// Map of states
	state

	// URL containing the current state
	url: URL = new URL(window.location.href)

	// set of callbacks to responfd to
	callbacks: Set<(key?: string, value?: unknown) => void>

	// an object with key value pairs that describe the
	// default state to use for when no options are specified
	defaultState: Record<string, unknown> = {}

	// use historyState to store the state into
	// the history API so clicking back will unset
	// the setting rather than leave the site.
	saveHistory = true

	// we can have query params or ?d=b64esfhsejkfhk
	encode = false

	// do we want the state to also handle the UI updates?
	controlUI = true

	originalClassList = ""

	// how many times has the state changed?
	stateChangeCount = 0

	set elementForClasses(element: HTMLElement) {
		this.element = element
		this.originalClassList = element.className
	}

	get elementForClasses() {
		return this.element ?? document.documentElement
	}

	// get encoded(){
	// 	return encodeLocation(this.serialised)
	// }

	// get serialised(){
	// 	return JSON.stringify(this.asObject )
	// }

	get asObject() {
		return Object.fromEntries(this.state)
	}

	get entries() {
		return this.state.entries()
	}

	get asURI() {
		return this.url.href
	}

	/**
	 * Set the URL search params from another URLSearchParams object
	 * @param {URLSearchParams} params
	 */
	set searchParams(params) {
		params.forEach((value: any, key: any) => {
			this.url.searchParams.set(key, value)
		})
	}

	/**
	 * Get the URL search params as a URLSearchParams object
	 * @returns {URLSearchParams}
	 */
	get searchParams() {
		return this.url.searchParams
	}

	/**
	 * Get the URL search params as a String
	 * @returns {String}
	 */
	get searchParamsAsString() {
		return this.url.searchParams.toString()
	}

	constructor(mainElement: HTMLElement | null) {
		this.state = new Map()
		this.callbacks = new Set()
		main = mainElement
		if (mainElement) {
			this.elementForClasses = mainElement
		}

		// URL has been updated internally?
		// IF the user has only just begun to use the app, this popstate should be empty
		// so rather than go "back" we instead relaod the application to restart
		// with the same state as before

		window.addEventListener("popstate", (event) => {
			if (event.state) {
				this.stateChangeCount++
				// console.info(this.stateChangeCount, "Previous State received: ", event, event.state)

				this.setState(event.state, true)
			} else {
				// console.error(this.stateChangeCount, "Previous State - NO STATE: ", event, event.state)
			}

			// FIXME: with back
			if (!hasNavigationOccurred || window.location.hash) {
				return
			}

			// console.log("RELOAD UNLESS IS HASH!", event)
			// console.log("location: " + document.location, hasNavigationOccurred, ", state: " + JSON.stringify(event.state))
			//window.location.reload()
		})
	}

	/**
	 * Browsers typically remember scroll position for  history state and
	 * will auto scroll when the location changes...
	 * NB. Does not work on IE
	 */
	preventAutoScrolling() {
		if ("scrollRestoration" in history) {
			history.scrollRestoration = "manual"
		}
	}

	/**
	 * Load the entire state from the URL and replace any
	 * existing state
	 * @param {Object} defaultState
	 * @param {Boolean} dispatchEvent - send out an event on complete
	 */
	loadFromLocation(defaultState: Record<string, unknown> | null = null, dispatchEvent = false) {
		// if default options are provided to override
		if (defaultState) {
			this.setDefaults(defaultState)
		}

		// now fetch the state from the URL
		const locationState = getLocationSettings(defaultState)

		// this may have come as a single encoded uri so we check
		return this.setState(locationState, dispatchEvent)
	}

	/**
	 * Fetch a state value
	 *
	 * @param {String} key
	 * @returns
	 */
	get(key: string) {
		return this.state.get(key)
	}

	/**
	 * Save a state value and update any dependent DOM UI
	 * @param {String} key
	 * @param {String} value
	 * @param {Boolean} dispatchEvent - send out an event on complete
	 */
	set(key: string, value: unknown, element: HTMLElement | null = null, dispatchEvent = true) {
		this.state.set(key, value)

		if (this.controlUI) {
			// set flag on main
			this.elementForClasses.classList.toggle(`flag-${key}`, Boolean(value))
		}

		// also update select for checked and things? bit more complex?
		// see if there is a matching dom element???
		if (element) {
			// debugger
			setElementCheckState(element, value)
			// element.checked = value
			//console.error("FSM>state", {key,to:value,checked:element.checked, element})
		}

		if (this.saveHistory) {
			const title = ""
			this.url = createStateURL(this.asObject)
			// window.history.replaceState( this.asObject, title, this.url )
			window.history.pushState(this.asObject, title, this.url)
		}

		if (dispatchEvent) {
			this.dispatchEvent(key, value)
		}
	}

	/**
	 * Change the state of a key from one to the opposite
	 * @param {String} key
	 * @param {HTMLElement} element
	 * @param {Boolean} dispatchEvent
	 * @returns
	 */
	toggle(key: string, element: HTMLElement | null = null, dispatchEvent = true) {
		const newState = !this.state.get(key)
		this.set(key, newState, element, dispatchEvent)
		return newState
	}

	/**
	 * Update the entire UI to match the current state
	 */
	updateFrontEnd() {
		let classNames = ""

		this.state.forEach((value, key) => {
			if (value) {
				classNames += `flag-${key} `
			}
			// TODO: try and find an associative input for selection
			// const input = document.querySelector(`input[name="${key}"]`)
		})

		// force selected atates etc
		this.elementForClasses.className = `${this.originalClassList} ${classNames}`
	}

	/**
	 * Replace the current state with a new one
	 * NB. This is very slow so do not do it regularly!
	 *
	 * @param {Object} newState
	 * @param {Boolean} dispatchEvent - send out an event on complete
	 */
	setState(newState: { [s: string]: unknown } | ArrayLike<unknown>, dispatchEvent = true) {
		// no new state provided
		if (!newState) {
			return this.state
		}

		// Build a bookmark without sending saved state in the request URL.
		this.url = createStateURL(newState)

		// this.searchParams = new URLSearchParams()

		// const keys = Object.keys(newState)
		// loop through and add these defaults
		// for(let key of keys)
		// {
		// 	this.state.set( key, newState[key] )
		// }

		this.state = new Map(Object.entries(newState))

		// update the front end
		if (this.controlUI) {
			// toggle them all at once!!!
			this.updateFrontEnd()
		}

		// remind all listeners about this transaction
		if (dispatchEvent) {
			this.dispatchEvent()
		}

		return this.state
	}

	/**
	 *
	 * @param {Object} defaultState
	 * @param {Boolean} dispatchEvent - send out an event on complete
	 */
	setDefaults(defaultState: Record<string, unknown>, dispatchEvent = false) {
		this.defaultState = defaultState
		return this.setState(defaultState, dispatchEvent)
	}

	/**
	 * Updates the URL with a compressed fragment of the existing state.
	 * @param {Boolean} _encode Retained for compatibility; state is always compressed.
	 */
	updateLocation(_encode = false) {
		this.url = createStateURL(this.asObject)
		window.history.replaceState(this.asObject, "", this.url)
	}

	/**
	 * Reset to the default options provided in
	 * the constructor
	 *
	 * @param {Boolean} dispatchEvent
	 */
	reset(dispatchEvent = false) {
		this.setState(this.defaultState, dispatchEvent)
	}

	/**
	 * Reload the state and dispatch an optional update
	 * @param {Boolean} dispatchEvent
	 */
	refresh(dispatchEvent = false) {
		this.loadFromLocation(null, dispatchEvent)
	}

	// -- EVENTS ---------------------------

	/**
	 *
	 * @param {String} key
	 * @param {Boolean|String|Object} value
	 */
	dispatchEvent(key?: string, value?: unknown) {
		// TODO: Only send changes?
		// const detail = { key, value }
		// const event = new CustomEvent(EVENT_STATE_CHANGE, { detail })
		if (this.callbacks.size) {
			this.callbacks.forEach((callback) => callback(key, value))
			// this.callbacks.forEach( callback => callback(event) )
		} else {
			window.dispatchEvent(new CustomEvent(EVENT_STATE_CHANGE, { detail: { key, value } }))
		}
	}

	addEventListener(callback: (key?: string, value?: unknown) => void) {
		this.callbacks.add(callback)
	}

	removeEventListener(callback: (key?: string, value?: unknown) => void) {
		this.callbacks.delete(callback)
	}
}

/**
 * Determine options for this session from three different
 * app sources, the query string, the global this and the domain specific options
 * @returns {Object}
 */
export const createStateOptionsFromHost = (extraOptions = {}) => {
	const globalOptions = Object.assign(
		{},
		(globalThis as typeof globalThis & { _synth?: Record<string, unknown> })._synth
	)
	const defaultOptions = { ...globalOptions, ...extraOptions }
	return defaultOptions
}

/**
 *
 * @param {HTMLElement} elementToAddClassTo
 * @param {Object} defaultOptions
 * @param {Class} StateClass
 * @returns
 */
export const createStateFromHost = (
	elementToAddClassTo: HTMLElement | null,
	defaultOptions: Record<string, unknown> | null = null,
	StateClass = State
) => {
	const stateOptions = defaultOptions ?? createStateOptionsFromHost()

	const state = StateClass.getInstance(elementToAddClassTo)

	//state.setDefaults(defaultOptions)
	state.loadFromLocation(stateOptions)

	// updates the URL with the current state (true - encoded)
	state.updateLocation()

	//state.setDefaults(defaultOptions)
	// stateMachine.loadFromLocation(defaultOptions)

	// Update UI - this will check all the inputs according to our state
	state.updateFrontEnd()

	// prevent URL changes from scrolling to that hash
	state.preventAutoScrolling()

	return state
}