import type IOChain from 'audiobus/io/IO-chain'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { applyPreset, savePreset } from './saved-presets'
import { createPresetBrowser } from './PresetBrowser'
import { element, button } from './dom'

export function createPresets(chain: IOChain, manager: IOChainManager) {
	const host = element('div', 'presets')
	const status = element('span')
	status.setAttribute('role', 'status')
	status.hidden = true
	const showStatus = (text: string) => {
		status.textContent = text
		status.hidden = !text
	}
	const browser = createPresetBrowser({
		hideTrigger: true,
		manager,
		onApply: (preset) => {
			applyPreset(chain, preset)
			showStatus(`${preset.name} applied`)
		},
	})
	const form = element('form', 'save-preset')
	form.hidden = true
	const name = element('input')
	name.required = true
	name.maxLength = 80
	const label = element('label', '', 'Preset name ')
	label.append(name)
	const save = element('button', '', 'Save')
	save.type = 'submit'
	const trigger = button(
		'',
		() => {
			name.value = chain.options.name ?? ''
			form.hidden = false
			trigger.setAttribute('aria-expanded', 'true')
			showStatus('')
			name.focus()
		},
		'chain-icon-button',
	)
	trigger.title = 'Save as preset'
	trigger.setAttribute('aria-expanded', 'false')
	trigger.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3 M7 21v-8h10v8" /></svg><span class="sr-only">Save as preset</span>'
	const close = () => {
		form.hidden = true
		trigger.setAttribute('aria-expanded', 'false')
	}
	form.append(label, save, button('Cancel', close))
	form.onsubmit = (event) => {
		event.preventDefault()
		try {
			savePreset(chain, name.value)
			close()
			showStatus('Preset saved')
		} catch (error) {
			showStatus(error instanceof Error ? error.message : String(error))
		}
	}
	host.append(browser.element, trigger, form, status)
	return {
		element: host,
		destroy() {
			browser.destroy()
			host.remove()
		},
	}
}