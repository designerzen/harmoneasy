import { PACKAGES, type PackageInfo } from '../config/packages-config'

export type { PackageInfo }

/**
 * Lazily load and generate HTML markup for packages list with versions and GitHub links
 */
export async function getPackagesListHTML(): Promise<string> {
	return PACKAGES.map(pkg => `
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
	return PACKAGES
}
