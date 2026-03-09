// Import package.json files for dynamic version loading
import netronomePackage from 'netronome/package.json'
import audiobusPackage from 'audiobus/package.json'
import audiotoolPackage from 'audiotool/package.json'
import flodjsPackage from 'flodjs/package.json'
import midiBlePackage from 'midi-ble/package.json'
import opendawPackage from 'opendaw/package.json'
import pinkTrombonePackage from 'pink-trombone/package.json'
import pitfallsPackage from 'pitfalls/package.json'

export interface PackageInfo {
	name: string
	version: string
	description: string
	repo: string
}

/**
 * Lazily load and generate HTML markup for packages list with versions and GitHub links
 * Versions are loaded dynamically from package.json files
 */
export async function getPackagesListHTML(): Promise<string> {
	const packages: PackageInfo[] = [
		{
			name: 'netronome',
			version: netronomePackage.version,
			description: netronomePackage.description,
			repo: netronomePackage.repository?.url || 'https://github.com/designerzen/netronome'
		},
		{
			name: 'audiobus',
			version: audiobusPackage.version,
			description: audiobusPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'audiotool',
			version: audiotoolPackage.version,
			description: audiotoolPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'flodjs',
			version: flodjsPackage.version,
			description: flodjsPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'midi-ble',
			version: midiBlePackage.version,
			description: midiBlePackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'opendaw',
			version: opendawPackage.version,
			description: opendawPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'pink-trombone',
			version: pinkTrombonePackage.version,
			description: pinkTrombonePackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'pitfalls',
			version: pitfallsPackage.version,
			description: pitfallsPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		}
	]

	return packages.map(pkg => `
<div class="package-item">
	<h6>${pkg.name} <span class="version">v${pkg.version}</span></h6>
	<p>${pkg.description}</p>
	<a href="${pkg.repo}" target="_blank" rel="noopener noreferrer">View on GitHub →</a>
</div>
	`).join('')
}

/**
 * Get the list of packages with their metadata
 */
export async function getPackagesList(): Promise<PackageInfo[]> {
	return [
		{
			name: 'netronome',
			version: netronomePackage.version,
			description: netronomePackage.description,
			repo: netronomePackage.repository?.url || 'https://github.com/designerzen/netronome'
		},
		{
			name: 'audiobus',
			version: audiobusPackage.version,
			description: audiobusPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'audiotool',
			version: audiotoolPackage.version,
			description: audiotoolPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'flodjs',
			version: flodjsPackage.version,
			description: flodjsPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'midi-ble',
			version: midiBlePackage.version,
			description: midiBlePackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'opendaw',
			version: opendawPackage.version,
			description: opendawPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'pink-trombone',
			version: pinkTrombonePackage.version,
			description: pinkTrombonePackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		},
		{
			name: 'pitfalls',
			version: pitfallsPackage.version,
			description: pitfallsPackage.description,
			repo: 'https://github.com/designerzen/harmoneasy'
		}
	]
}
