/**
 * Electron Module Loader
 * Handles loading electron modules from multiple possible paths
 * Tries packaged path first, then development path
 */

export async function loadElectronModule(moduleName) {
	const paths = [
		`./${moduleName}.js`,                    // Packaged app (root)
		`./source/electron/${moduleName}.js`,   // Development (source)
	]
	
	let lastError = null
	
	for (const modulePath of paths) {
		try {
			const module = await import(modulePath)
			console.log(`Loaded electron module '${moduleName}' from: ${modulePath}`)
			return module
		} catch (e) {
			lastError = e
			continue
		}
	}
	
	throw new Error(`Could not load electron module '${moduleName}' from any path. Last error: ${lastError?.message}`)
}
