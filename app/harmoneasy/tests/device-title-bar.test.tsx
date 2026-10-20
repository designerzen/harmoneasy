// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DeviceTitleBar } from '../source/components/graph/DeviceTitleBar'
import { ChainContext } from '../source/components/graph/ChainContext'
import InputManager from '../../../packages/audiobus/io/input-manager'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import AbstractInput from '../../../packages/audiobus/io/inputs/abstract-input'

vi.mock('../source/components/graph/element-icons', () => ({ deviceIcon: () => '', elementDescription: () => '' }))
class Input extends AbstractInput { destroy() {} }

it('exposes labelled title controls and updates the toggle when the manager changes', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const input = new Input(), inputManager = new InputManager(), outputManager = new OutputManager()
    inputManager.add(input)
    const chain = { inputManager, outputManager,
        setInputEnabled: (device: Input, enabled: boolean) => inputManager.setEnabled(device, enabled) }
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const onRemove = vi.fn(), onExpand = vi.fn(), onMinimise = vi.fn()
    try {
        await act(async () => root.render(<ChainContext.Provider value={{ chain } as any}>
            <DeviceTitleBar device={input} direction="input" expanded={false} compact={false} onMinimise={onMinimise} onRemove={onRemove} onExpand={onExpand} />
        </ChainContext.Provider>))
        const buttons = host.querySelectorAll('button')
        const toggle = host.querySelector<HTMLButtonElement>('.device-toggle')!
        expect(buttons).toHaveLength(5)
        expect(buttons[0].getAttribute('aria-label')).toBe('Remove input')
        expect(host.querySelector('header')!.lastElementChild!.tagName).toBe('H6')
        expect(host.querySelector('.device-swap')!.textContent).toBe('Swap')
        expect(host.querySelector('.node-actions-left')!.querySelectorAll('button')).toHaveLength(2)
        expect(host.querySelector('.node-actions-right')!.querySelectorAll('button')).toHaveLength(3)
        const minimise = host.querySelector<HTMLButtonElement>('.device-minimise')!
        expect(minimise.getAttribute('aria-label')).toBe('Minimise input')
        await act(async () => minimise.click())
        expect(onMinimise).toHaveBeenCalledOnce()
        expect([...buttons].every(button => button.title && button.getAttribute('aria-label'))).toBe(true)
        await act(async () => toggle.click())
        expect(inputManager.isEnabled(input)).toBe(false)
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(toggle.getAttribute('aria-label')).toBe('Enable input')
        await act(async () => inputManager.setEnabled(input, true))
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        await act(async () => { host.querySelector<HTMLButtonElement>('.device-expand')!.click(); buttons[0].click() })
        expect(onExpand).toHaveBeenCalledOnce()
        expect(onRemove).toHaveBeenCalledOnce()
        await act(async () => root.render(<ChainContext.Provider value={{ chain } as any}>
            <DeviceTitleBar device={input} direction="input" expanded={false} compact onMinimise={onMinimise} onRemove={onRemove} onExpand={onExpand} />
        </ChainContext.Provider>))
        expect(minimise.getAttribute('aria-label')).toBe('Restore input')
        expect(minimise.getAttribute('aria-expanded')).toBe('false')
    } finally {
        await act(async () => root.unmount())
        host.remove(); inputManager.destroy(); outputManager.destroy()
    }
})
