import type IOChain from 'audiobus/io/IO-chain'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { applyPreset, readPresets, savePreset } from './saved-presets'
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
	const dialog = element('dialog', 'save-preset-dialog')
	const title = element('h2', '', 'Save as a Preset')
	title.id = `save-preset-${crypto.randomUUID()}`
	dialog.setAttribute('aria-labelledby', title.id)
	const form = element('form', 'save-preset')
	const name = element('input')
	name.required = true
	name.maxLength = 80
	name.autofocus = true
	const label = element('label', '', 'Preset name')
	label.append(name)
	const message = element('p')
	message.setAttribute('role', 'status')
	message.hidden = true
	const save = element('button', 'primary', 'Save')
	save.type = 'submit'
	let overwriteId: string | undefined
	const close = () => dialog.close()
	const rename = button('Rename', () => {
		overwriteId = undefined
		message.hidden = true
		save.textContent = 'Save'
		rename.hidden = true
		name.readOnly = false
		name.focus()
		name.select()
	})
	rename.hidden = true
	const actions = element('div', 'save-preset-actions')
	actions.append(save, rename, button('Cancel', close))
	form.append(label, message, actions)
	form.onsubmit = (event) => {
		event.preventDefault()
		try {
			if (!overwriteId) {
				const duplicate = readPresets().find(item => item.name.toLowerCase() === name.value.trim().toLowerCase())
				if (duplicate) {
					overwriteId = duplicate.id
					message.textContent = `A preset named “${duplicate.name}” already exists. Overwrite it with this chain, or rename your new preset.`
					message.hidden = false
					save.textContent = 'Overwrite'
					rename.hidden = false
					name.readOnly = true
					rename.focus()
					return
				}
			}
			savePreset(chain, name.value, overwriteId)
			close()
			showStatus('Preset saved')
		} catch (error) {
			message.textContent = error instanceof Error ? error.message : String(error)
			message.hidden = false
		}
	}
	dialog.append(title, form)
	document.body.append(dialog)
	host.append(browser.element, status)
	return {
		element: host,
		openSave() {
			name.value = chain.options.name ?? ''
			name.readOnly = false
			overwriteId = undefined
			message.hidden = true
			rename.hidden = true
			save.textContent = 'Save'
			showStatus('')
			dialog.showModal()
			name.focus()
			name.select()
		},
		destroy() {
			dialog.close()
			dialog.remove()
			browser.destroy()
			host.remove()
		},
	}
}
