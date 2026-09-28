import { useChain } from './ChainContext'
import React, { memo, useCallback } from "react"
 
/**
 * ConfigField component - memoized to prevent unnecessary re-renders
 */
export const ConfigField = memo(function ConfigField({ config, element }: { config: any; element: any }) {
	const { chain } = useChain()
	const handleChange = useCallback((v: React.ChangeEvent<HTMLSelectElement>) => {
		element.setConfig(config.name, v.target.value)
        chain.dispatchEvent(new Event('configurationChanged'))
	}, [config.name, element, chain])

	return <label>
        {config.name === 'enabled' ? <span className="config-enabled-label">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2v10M6 5a9 9 0 1 0 12 0" />
            </svg>
            {config.name}
        </span> : config.name}
		{ config.type === 'select' ? <SelectField values={config.values} defaultValue={config.default} onChange={handleChange} /> : 'unknown' }
	</label>
	
}, (prevProps, nextProps) => {
	// Only re-render if config values changed
	return (
		prevProps.config.name === nextProps.config.name &&
		prevProps.config.default === nextProps.config.default &&
		(prevProps.config.values?.length ?? 0) === (nextProps.config.values?.length ?? 0) &&
		prevProps.element === nextProps.element
	)
})
/**
 * SelectField component - memoized to prevent unnecessary re-renders
 * GAH React is so crap it doesn't allow modern html already landed in browsers
 */
export const SelectField = memo(function SelectField({ values, onChange, defaultValue }: { values: any[]; onChange: React.ChangeEventHandler<HTMLSelectElement>; defaultValue?: string | number }) {
	return <select onChange={onChange} suppressHydrationWarning={true} defaultValue={defaultValue ?? ''}>

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
		prevProps.values.length === nextProps.values.length &&
		prevProps.values.every((v, i) => {
			const curr = nextProps.values[i]
			const prevVal = typeof v === 'object' ? v.value : v
			const currVal = typeof curr === 'object' ? curr.value : curr
			return prevVal === currVal
		})
	)
})
