import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, Duration } from 'obsidian';

// Remember to rename these classes and interfaces!

interface PluginSettings {
	googleClientId: string;
	googleClientSecret: string;

}

const DEFAULT_SETTINGS: PluginSettings = {
	googleClientId: "",
	googleClientSecret: ""
}

function uniqueIdFromTask(task) {
	const fileName = task.path; // The file where the task is located.
	const lineNumber = task.line; // The line number where the task is located.
	const hash = `${fileName}:${lineNumber}:${task.text}`; // Create a hash string.

	// Generate a unique ID using a simple hash function.
	const uniqueId = hash.split('').reduce((acc, char) => {
		acc = ((acc << 5) - acc) + char.charCodeAt(0);
		return acc & acc;
	}, 0).toString(16);

	if (uniqueId[0] === "-") {
		return "a" + uniqueId.slice(1)
	}

	return uniqueId
}

class TimeOfDay {
	constructor(hour, minute) {
		this.hour = hour;
		this.minute = minute;
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function raiseErrorAfterMillis(msg) {
	await sleep(1000)
	new Notice(msg);
	throw new Error(msg);
}

function createTimeFromDuration(duration) {
	if (!(duration.values && duration.values.hours && duration.values.minutes)) {
		return [null, "Duration should be moment duration"]
	}
	if (duration.values.hours > 23 || duration.values.hours < 0) {
		return [null, "hour should be between 0 and 23"]
	}
	if (duration.values.minutes > 59 || duration.values.minutes < 0) {
		return [null, "minutes should be between 0 and 59"]
	}
	for (const [key, value] of Object.entries(duration.values)) {
		if (["hours", "minutes"].contains(key)) {
			continue
		}
		if (value !== 0) {
			return [null, "only hours and minutes should be populated"]
		}
	}

	return [new TimeOfDay(duration.values.hours, duration.values.minutes), null]
}

class TaskService {
	constructor(dv, app) {
		this.dv = dv
		this.app = app
		this.isRunning = false
	}

	// ar fi chiar nice niste teste, cum naiba scriu teste?
	async syncTasks(tasks, file = null) {
		console.log("reached here", this.isRunning)
		if (this.isRunning === true) {
			return
		}

		this.isRunning = true
		try {
			const tasksWithoutId = tasks.filter((e) => !e.text.contains("🆔"))
			if (tasksWithoutId.length !== 0) {
				await this.writeIdsToFiles(tasksWithoutId, file)
			}
			let err
			err = this.populateTasksWithIds(tasks)
			if (err !== null) {
				await raiseErrorAfterMillis(err)
			}
			err = this.populateTasksWithTime(tasks)
			if (err !== null) {
				await raiseErrorAfterMillis(err)
			}
		} finally {
			this.isRunning = false
		}
	}

	populateTasksWithTime(tasks) {
		let err
		for (const task of tasks) {
			[task.startTime, err] = createTimeFromDuration(task.start)
			if (err !== null) {
				return err
			}
			[task.endTime, err] = createTimeFromDuration(task.end)
			if (err !== null) {
				return err
			}
		}
		return null
	}

	populateTasksWithIds(tasks) {
		for (const task of tasks) {
			if (!task.id) {
				const match = task.text.match(/🆔 \w+/)
				console.log()
				if (!match) {
					return `this ${task.text} should contain an id`
				}
				task.id = match[0].slice(2).trim();
			}
		}
		return null
	}

	async writeIdsToFiles(tasks, file) {
		let tasksByFile = {}
		if (file !== null) {
			tasksByFile[file.path] = [file, tasks]
		} else {
			for (const task of tasks) {
				if (tasksByFile[task.path] === undefined) {
					const file = this.app.vault.getAbstractFileByPath(task.path);
					tasksByFile[task.path] = [file, []]
				}
				tasksByFile[task.path][1].push(task)
			}
		}
		for (const [path, [file, tasks]] of Object.entries(tasksByFile)) {
			let content = await this.app.vault.read(file);

			for (const task of tasks) {
				const chosenId = uniqueIdFromTask(task)
				task.id = chosenId

				const toFind = `- [${task.status}] ${task.text}`
				let count = 0;
				let position = content.indexOf(toFind);

				while (position !== -1) {
					count++;
					position = content.indexOf(toFind, position + toFind.length);
				}
				if (count > 1) {
					await raiseErrorAfterMillis(`The string "${toFind} was found ${count} times in document ${path}`)
				}

				content = content.replace(toFind, (match) => {
					return match + ` 🆔 ${chosenId}`;
				})
			}
			await this.app.vault.modify(file, content);
		}
	}
}

export default class SyncGoogleCalendarPlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// page, nu pages ca sa iei numa o pagina, lol
		this.app.workspace.onLayoutReady(() => {
			const dataViewPlugin = app.plugins.getPlugin('dataview')
			if (dataViewPlugin) {
				const dv = dataViewPlugin.api
				const taskService = new TaskService(dv, app)

				this.registerEvent(
					this.app.vault.on('modify', async (file) => {
						if (file instanceof TFile && file.extension === 'md') {
							setTimeout(async () => {
								const tasks = dv.pages().file.tasks.filter((e) => !e.completed && e.start && e.end && e.scheduled)
								await taskService.syncTasks(tasks)
							}, 1000)
						}
					}
					)
				)
			} else {
				new Notice('No dataview plugin installed. Please install dataview and restart obsidian');
			}
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: SyncGoogleCalendarPlugin;

	constructor(app: App, plugin: SyncGoogleCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Google client id')
			.setDesc('google client id')
			.addText(text => text
				.setPlaceholder('Enter google client id')
				.setValue(this.plugin.settings.googleClientId)
				.onChange(async (value) => {
					this.plugin.settings.googleClientId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Google client secret')
			.setDesc('google client secret')
			.addText(text => text
				.setPlaceholder('Enter google client secret')
				.setValue(this.plugin.settings.googleClientSecret)
				.onChange(async (value) => {
					this.plugin.settings.googleClientSecret = value;
					await this.plugin.saveSettings();
				}));
	}
}
