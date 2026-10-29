import { useChain } from './ChainContext'
import React, { memo, useCallback, useId, useState } from "react"
import { EVENT_CONFIGURATION_CHANGED } from 'audiobus/event-constants'
 
/**
 * ConfigField component - memoized to prevent unnecessary re-renders
 */
export const ConfigField = memo(function ConfigField({ config, element }: { config: any; element: any }) {
	const { chain } = useChain()
    const helpId = useId()
    const [error, setError] = useState('')
	const handleChange = useCallback((v: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
        try {
            element.setConfig(config.name, v.target.value)
            setError('')
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error))
            return
        }
        chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
	}, [config.name, element, chain])

	return <label data-midi-ignore="" className={config.help ? 'config-field has-help' : 'config-field'}>
        {config.name === 'enabled' ? <span className="config-enabled-label">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2v10M6 5a9 9 0 1 0 12 0" />
            </svg>
            {config.label ?? 'Enabled'}
        </span> : config.label ?? config.name}
		{ config.type === 'select' ? <SelectField values={config.values} defaultValue={config.default} onChange={handleChange} describedBy={config.help ? helpId : undefined} />
            : config.type === 'text' ? <input className="nodrag nopan" type="text" defaultValue={config.default ?? ''} placeholder={config.placeholder} aria-describedby={config.help ? helpId : undefined} onBlur={handleChange} /> : 'unknown' }
        {config.help && <small id={helpId} className="config-field-help">{config.help}</small>}
        {error && <small role="alert" className="config-field-help">{error}</small>}
	</label>
	
}, (prevProps, nextProps) => {
	// Only re-render if config values changed
	return (
		prevProps.config.name === nextProps.config.name &&
		prevProps.config.default === nextProps.config.default &&
        prevProps.config.label === nextProps.config.label &&
        prevProps.config.help === nextProps.config.help &&
        prevProps.config.placeholder === nextProps.config.placeholder &&
		(prevProps.config.values?.length ?? 0) === (nextProps.config.values?.length ?? 0) &&
		prevProps.element === nextProps.element
	)
})
/**
 * SelectField component - memoized to prevent unnecessary re-renders
 * GAH React is so crap it doesn't allow modern html already landed in browsers
 */
export const SelectField = memo(function SelectField({ values, onChange, defaultValue, describedBy }: { values: any[]; onChange: React.ChangeEventHandler<HTMLSelectElement>; defaultValue?: string | number; describedBy?: string }) {
	return <select className="nodrag nopan" aria-describedby={describedBy} onChange={onChange} suppressHydrationWarning={true} defaultValue={defaultValue ?? ''}>

		{values.map((v) => {
			const isObject = typeof v === 'object' && v !== null
			const value = isObject ? v.value : v
			const name = isObject ? v.name : v
			return ( <option 
				key={value} 
				value={value}>
					{name}
				</option>)
		})}
	</select>
}, (prevProps, nextProps) => {
	// Custom comparison: only re-render if values, onChange, or defaultValue change
	return (
		prevProps.defaultValue === nextProps.defaultValue &&
        prevProps.onChange === nextProps.onChange &&
        prevProps.describedBy === nextProps.describedBy &&
		prevProps.values.length === nextProps.values.length &&
		prevProps.values.every((v, i) => {
			const curr = nextProps.values[i]
			const prevVal = typeof v === 'object' ? v.value : v
			const currVal = typeof curr === 'object' ? curr.value : curr
			return prevVal === currVal && (typeof v !== 'object' || v.name === curr.name)
		})
	)
})

export function TransformerSettings({ fields, element, expanded }: { fields: any[]; element: any; expanded: boolean }) {
    const renderField = (field: any) => <ConfigField key={`${field.name}-${element.options[field.name] ?? field.default}`}
        config={{ ...field, default: element.options[field.name] ?? field.default }} element={element} />
    if (!fields.some(field => field.group)) {
        return expanded ? <div className="expanded-node-settings">{fields.map(renderField)}</div> : <>{fields.map(renderField)}</>
    }
    const groups = new Map<string, any[]>()
    for (const field of fields) {
        const group = field.group ?? 'Melody'
        groups.set(group, [...(groups.get(group) ?? []), field])
    }
    return <div className="transformer-settings nodrag nopan nowheel">
        {typeof element.instructions === 'string' && <div className="transformer-guide">
            <strong>Start playing</strong><p>{element.instructions}</p>
        </div>}
        {[...groups].map(([group, grouped], index) => index === 0
            ? <fieldset className="transformer-setting-group" key={group}><legend>{group}</legend><div className="transformer-setting-fields">{grouped.map(renderField)}</div></fieldset>
            : <details className="transformer-setting-group" key={group}>
                <summary>{group}<span className="setting-count">{grouped.length} settings</span></summary>
                <div className="transformer-setting-fields">{grouped.map(renderField)}</div>
            </details>)}
    </div>
}
