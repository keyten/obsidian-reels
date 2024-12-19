import ReelsPlugin from "main";
import { App, PluginSettingTab, Setting, TFolder } from "obsidian";

export default class ReelsSettingTab extends PluginSettingTab {
	plugin: ReelsPlugin;

	constructor(app: App, plugin: ReelsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h2', { text: 'Reels Settings' });

		new Setting(containerEl)
			.setName('Video Location')
			.setDesc('Where video files and thumbnails should be saved')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('defaultAttachment', 'Default attachment location')
					.addOption('specifiedFolder', 'In the folder specified below')
					.setValue(this.plugin.settings.videoLocationMode)
					.onChange(async (value) => {
						this.plugin.settings.videoLocationMode = value;
						this.display();
						await this.plugin.saveSettings();
					})
			);

		if (this.plugin.settings.videoLocationMode === 'defaultAttachment'){
			//@ts-ignore
			const attachmentLocation = this.app.vault.getConfig('attachmentFolderPath');
			new Setting(containerEl)
				.setName('Default attachment location')
				.setDesc('Options > Files & Links > Default location for new attachments')
				.addText((text) =>
					text
						.setValue(attachmentLocation)
						.setDisabled(true)
				)
				.setClass('default-attachment-info')
		} else if (this.plugin.settings.videoLocationMode === 'specifiedFolder') {
			new Setting(containerEl)
				.setName('Video Folder')
				.setDesc('The folder where video files and thumbnails should be saved')
				.addDropdown((dropdown) => {
					// Add root folder option
					dropdown.addOption('/', 'Root');
					
					// Add all folders from the vault
					this.app.vault.getAllLoadedFiles().forEach((file) => {
						if (file instanceof TFolder && file.path !== '/') {
							dropdown.addOption(file.path, file.path);
						}
					});

					dropdown
						.setValue(this.plugin.settings.customFolderPath || '/')
						.onChange(async (value) => {
							this.plugin.settings.customFolderPath = value;
							await this.plugin.saveSettings();
						});
				});
		}

		new Setting(containerEl)
			.setName('Responsive Card-Style Thumbnails')
			.setDesc('Switch to card-style thumbnails for narrow screens')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.responsiveCardStyle)
					.onChange(async (value) => {
						this.plugin.settings.responsiveCardStyle = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
