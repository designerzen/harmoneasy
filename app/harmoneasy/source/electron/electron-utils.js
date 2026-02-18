/**
 * Electron utilities - provides safe access to Electron APIs from renderer process
 */

declare global {
	interface Window {
		electronAPI?: {
			getVersion: () => Promise<string>
			getAppPath: (name: string) => Promise<string>
			minimize: () => void
			maximize: () => void
			close: () => void
			openFile: (options: any) => Promise<any>
			saveFile: (options: any) => Promise<any>
			platform: string
			isDev: boolean
		}
	}
}

export const isElectron = (): boolean => {
	return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
};

export const electronAPI = {
	async getVersion(): Promise<string> {
		if (!isElectron()) throw new Error('Not running in Electron')
		return window.electronAPI!.getVersion();
	},

	async getAppPath(name: string): Promise<string> {
		if (!isElectron()) throw new Error('Not running in Electron')
		return window.electronAPI!.getAppPath(name)
	},

	minimize(): void {
		if (!isElectron()) return
		window.electronAPI!.minimize()
	},

	maximize(): void {
		if (!isElectron()) return
		window.electronAPI!.maximize()
	},

	close(): void {
		if (!isElectron()) return
		window.electronAPI!.close()
	},

	async openFile(options: any): Promise<any> {
		if (!isElectron()) throw new Error('Not running in Electron')
		return window.electronAPI!.openFile(options)
	},

	async saveFile(options: any): Promise<any> {
		if (!isElectron()) throw new Error('Not running in Electron')
		return window.electronAPI!.saveFile(options)
	},

	getPlatform(): string {
		if (!isElectron()) return 'web'
		return window.electronAPI!.platform
	},

	isDev(): boolean {
		if (!isElectron()) return false
		return window.electronAPI!.isDev
	}
}