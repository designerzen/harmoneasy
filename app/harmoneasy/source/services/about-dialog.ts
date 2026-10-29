import { EVENT_CLICK } from "audiobus/event-constants"
import { version, author } from "../../../../package.json"
import { getPackagesListHTML } from "./packages-service"

export function createAboutDialog(root: Document) {
	const dialog = root.querySelector<HTMLDialogElement>("#about-dialog")!
	root.querySelector("#about-version")!.textContent = `Version ${version}`
	root.querySelector("#about-copyright")!.textContent =
		`© ${new Date().getFullYear()} ${author.replace(/\s*<[^>]*>/g, "")}`
	let loaded: Promise<void> | undefined
	const loadCredits = async () => {
		const [{ default: credits }, { default: bundled }, packages] = await Promise.all([
			import("../config/credits-config.json"),
			import("../config/bundled-credits-config.json"),
			getPackagesListHTML()
		])
		root.querySelector("#about-packages")!.innerHTML = packages
		const assets = root.querySelector("#about-asset-credits")!
		for (const path of bundled) {
			const item = root.createElement("li")
			const link = root.createElement("a")
			link.textContent = path
				.split("/")
				.pop()!
				.replace(/-LICENSE/i, " licence")
				.replace(/\.txt$/, "")
			link.href = `${import.meta.env.BASE_URL}${path}`
			link.target = "_blank"
			link.rel = "noopener noreferrer"
			item.append(link)
			assets.append(item)
		}
		const list = root.querySelector("#about-credits")!
		const fragment = root.createDocumentFragment()
		for (const credit of credits) {
			const item = root.createElement("li")
			const name = root.createElement("a")
			const url = credit.url
				.replace(/^git\+/, "")
				.replace(/^git:\/\//, "https://")
				.replace(/\.git$/, "")
			name.textContent = `${credit.name} ${credit.version}`
			if (/^https?:\/\//.test(url)) {
				name.href = url
				name.target = "_blank"
				name.rel = "noopener noreferrer"
			}
			const detail = root.createElement("span")
			detail.textContent = `${credit.authors.join(", ") || "The project’s authors and contributors"}${credit.license ? ` · ${credit.license}` : ""}`
			item.append(name, detail)
			fragment.append(item)
		}
		list.replaceChildren(fragment)
	}
	root.querySelectorAll<HTMLButtonElement>("[data-about]").forEach((logo) => {
		logo.addEventListener(EVENT_CLICK, () => {
			if (!dialog.open) {
				dialog.showModal()
			}
			loaded ??= loadCredits().catch(() => {
				root.querySelector("#about-credits")!.textContent =
					"Credits could not be loaded. Close and reopen this dialog to retry."
				loaded = undefined
			})
		})
	})
}