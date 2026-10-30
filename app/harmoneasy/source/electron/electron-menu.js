// Menu
export const createMenuTemplate = (app) => [
	{
		label: "File",
		submenu: [
			{
				label: "Exit",
				accelerator: "CmdOrCtrl+Q",
				click: () => {
					app.quit()
				}
			}
		]
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" }
		]
	},
	{
		label: "View",
		submenu: [
			{
				label: "Command Palette…",
				accelerator: "CmdOrCtrl+K",
				click: (_item, window) => {
					window?.webContents
						.executeJavaScript(
							'document.getElementById("btn-command-palette")?.click()'
						)
						.catch((error) => console.error("Could not open command palette:", error))
				}
			},
			{ type: "separator" },
			{ role: "reload" },
			{ role: "forceReload" },
			{ role: "toggleDevTools" },
			{ type: "separator" },
			{ role: "resetZoom" },
			{ role: "zoomIn" },
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" }
		]
	},
	{
		label: "Help",
		submenu: [
			{
				label: "About",
				click: () => {
					// TODO: Show about dialog
				}
			}
		]
	}
]