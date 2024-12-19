import { Editor, MarkdownRenderer, MarkdownRenderChild, Plugin, MarkdownView, Notice, requestUrl, RequestUrlParam, MarkdownPostProcessorContext, EditorPosition, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import ReelsSettingTab from "./settings";
import { downloadInstagramReel } from './insta_api';

// 

interface ReelInfo {
	url: string;
	thumbnail: string;
	video: string;
	vidFound: boolean;
	networkError: boolean;
	videoSaved: boolean;
	imageSaved: boolean;
	author: string;
	authorUrl: string;
	caption: string;
}

interface ReelsSettings {
	videoLocationMode: string;
	customFolderPath: string;
	responsiveCardStyle: boolean;
}

const DEFAULT_SETTINGS: Partial<ReelsSettings> = {
	videoLocationMode: 'defaultAttachment',
	customFolderPath: 'Files/Reels',
	responsiveCardStyle: true
};

const URL_TYPES = {
	instagram: [
		{match: 'instagram.com/reel/', idPattern: /reel\/([\w-]+)/},
		{match: 'instagram.com/p/', idPattern: /p\/([\w-]+)/}
	]
};

export default class ReelsPlugin extends Plugin {
	settings: ReelsSettings;
	private editorObserver: ResizeObserver;

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Run responsive check in case responsiveCardStyle setting changed
		const editors = document.querySelectorAll('.workspace-leaf');
		for (const key in editors) {
			if (Object.prototype.hasOwnProperty.call(editors, key)) {
				const editor = editors[key];
				this.responsiveCardCheck(editor);
			}
		}
	}

	responsiveCardCheck(editor: Element){
		const reelBlocks = editor.querySelectorAll('.block-language-reel');

		for (const key in reelBlocks) {
			if (Object.prototype.hasOwnProperty.call(reelBlocks, key)) {
				const block = reelBlocks[key] as HTMLElement;
				if (this.settings.responsiveCardStyle && block && block.offsetWidth < 370) {
					block.addClass('thumbnail-card-style');
				} else {
					block.removeClass('thumbnail-card-style');
				}
			}
		}
	}

	setEditorResizeObservers(){
		this.editorObserver.disconnect();
		const editorElems = document.querySelectorAll(".workspace-leaf");
		for (const key in editorElems) {
			if (Object.prototype.hasOwnProperty.call(editorElems, key)) {
				const editor = editorElems[key];

				this.editorObserver.observe(editor);
			}
		}
	}

	getAllLeaves() {
		const ret = [] as WorkspaceLeaf[];
		this.app.workspace.iterateAllLeaves(leaf => { ret.push(leaf) })
		return ret;
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ReelsSettingTab(this.app, this));

		let seenLeaves = new Set(this.getAllLeaves());
		this.app.workspace.on("layout-change", () => {
			const currentLeaves = this.getAllLeaves();
			const newLeaves = currentLeaves.filter((leaf) => !seenLeaves.has(leaf)); // contains newly opened tabs
			seenLeaves = new Set(currentLeaves);
			if(newLeaves.length > 0){
				this.setEditorResizeObservers();
			}
		});

		this.editorObserver = new ResizeObserver((entries) => {
			for (const editor of entries) {
				this.responsiveCardCheck(editor.target);
			}
		});

		const editorElems = document.querySelectorAll('.workspace-leaf');
		if(editorElems.length === 0){
			// If it's a new window
			document.addEventListener('DOMContentLoaded', () => {
				this.setEditorResizeObservers();
			});
		}
		else{
			// If exiting window reloading the plugin
			this.setEditorResizeObservers();
		}

		this.registerMarkdownCodeBlockProcessor('reel', async (source, el, ctx) => {
			this.createDummyBlock(el);
			const sourceLines = source.trim().split('\n');
			const url = sourceLines[0];
			let info: ReelInfo = this.parseStoredInfo(source);

			if (!info.videoSaved) {
				Object.assign(info, await this.getVideoInfo(url));
			}

			if (info.networkError && !info.videoSaved) {
				// If offline and info not stored, just show link
				this.removeDummyBlock(el);
				const url = source.trim().split('\n')[0];
				el.createEl('a', { text: url, href: url });
				return;
			}

			const sourcePath =
				typeof ctx == "string"
					? ctx
					: ctx?.sourcePath ??
					this.app.workspace.getActiveFile()?.path ??
					"";

					console.log(info);
			if (!info.vidFound) {
				const component = new MarkdownRenderChild(el);
				this.removeDummyBlock(el);
				MarkdownRenderer.renderMarkdown(
					`>[!WARNING] Cannot find reel\n>${info.url}`,
					el,
					sourcePath,
					component
				);
				return;
			}

			if (this.hasManyUrls(sourceLines)){
				const component = new MarkdownRenderChild(el);
				this.removeDummyBlock(el);
				MarkdownRenderer.renderMarkdown(
					`>[!WARNING] Cannot accept multiple URLs yet`,
					el,
					sourcePath,
					component
				);
				return;
			}

			// Sketchy? Can get be called infinitely if this.storeVideoInfo changes text
			// and it doesn't make this.parseStoredInfo set info.videoSaved to true
			if (!info.videoSaved) {
				this.storeVideoInfo(info, el, ctx);
			}

			this.removeDummyBlock(el);
			this.createThumbnail(el, info);
		});
	}

	onunload() {
		if (this.editorObserver) {
			this.editorObserver.disconnect();
		}
	}

	hasManyUrls(lines: string[]): boolean{
		// Will be used for future features
		return (lines.length > 1 && lines.every(e => (/^((https*:\/\/)|(www\.))+\S*$/).test(e.trim())))
	}

	createThumbnail(el: HTMLElement, info: ReelInfo) {
		let thumbnailUrl = info.thumbnail;
		if(thumbnailUrl && this.pathIsLocal(thumbnailUrl)){
			const file = this.app.vault.getAbstractFileByPath(thumbnailUrl);

			if(file){
				//@ts-ignore
				thumbnailUrl = this.app.vault.getResourcePath(file);
			}
		}



		const container = el.createEl('a', { href: info.url });
		container.addClass('thumbnail');
		const imgEl = container.createEl('img', { attr: { 'src': thumbnailUrl } });
		imgEl.addClass("thumbnail-img");
		const textBox = container.createDiv();
		textBox.addClass('thumbnail-text');
		textBox.createEl('a', {
			text: info.author, 
			href: info.authorUrl, 
			title: info.author
		}).addClass('thumbnail-author');
		const caption = info.caption.replace(/\\n/g, '\n');
		textBox.createDiv({text: caption, title: caption}).addClass('thumbnail-title');

		const timestamp = this.getTimestamp(info.url);
		if(timestamp !== ''){
			const timestampEl = container.createDiv({text: timestamp});
			timestampEl.addClass('timestamp');

			// Resize observer on thumbnail img's
			const resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					// Position timestamp
					const timeTop = imgEl.offsetHeight - 22;
					timestampEl.style.setProperty('top', `${timeTop}px`);
				}
			});

			const domObserver = new MutationObserver(function(mutations) {

				if(el.contains(imgEl)){

					if(imgEl.offsetHeight === 0){
						// return;
					}
					resizeObserver.observe(imgEl);
					// const timeTop = imgEl.offsetHeight - 22;
					// timestampEl.style.setProperty('top', `${timeTop}px`);
					domObserver.disconnect();
				}
			});

			domObserver.observe(document, {attributes: false, childList: true, characterData: false, subtree:true});


			// timestampEl.style.top = `${imgEl.height}px`;
		}
	}

	createDummyBlock(el: HTMLElement) {
		const container = el.createDiv();
		container.addClass('dummy-container');
		// container.createDiv().addClass('dummy-image');
		// container.createDiv().addClass('dummy-title');
	}

	removeDummyBlock(el: HTMLElement) {
		const dummy = el.querySelector('.dummy-container');
		if(dummy){
			el.removeChild(dummy);
		}
	}

	getTimestamp(url: string): string {
		let tIndex = url.indexOf('?t=');
		if(tIndex === -1){
			tIndex = url.indexOf('&t=');
		}
		if(tIndex === -1){
			tIndex = url.indexOf('#t=');
		}
		if(tIndex === -1){
			return '';
		}

		const search = (/[?&#]t=(?:(\d+)h)*(?:(\d+)m)*(?:(\d+)s)*(\d+)*/).exec(url);
		search.shift();
		const times = search.map((v) => parseInt(v) || 0);
		//0-h 1-m 2-s 3-s(seconds only format)

		let seconds = times.pop();

		if(times[2] > 59){
			// Vimeo seconds only format still includes an "s"
			// so it ends up in times[2] instead of times[3]
			seconds = times[2];
		}
		if(seconds){
			times[2] = seconds % 60;
			times[1] = Math.floor(seconds / 60) % 60;
			times[0] = Math.floor(seconds / 3600);
		}
		const secStr = String(times[2]).padStart(2, '0');
		let minStr = String(times[1]);
		const hrStr = String(times[0]);

		let timeStr = `${minStr}:${secStr}`;
		if(times[0]){
			minStr = minStr.padStart(2, '0');
			timeStr = `${hrStr}:${minStr}:${secStr}`;
		}

		return timeStr;
	}

	pathIsLocal(path: string): boolean{
		return path.indexOf('https://') !== 0;
	}

	parseStoredInfo(source: string): ReelInfo {
		const info: ReelInfo = {
			url: '',
			thumbnail: '',
			video: '',

			vidFound: false,
			networkError: false,
			videoSaved: false,
			imageSaved: false,
			author: '',
			authorUrl: '',
			caption: ''
		};

		const input = source.trim().split('\n');
		if (input.length !== 6) {
			return info;
		}

		const parsedInput = {
			Url: '',
			Video: '',
			Thumbnail: '',
			Author: '',
			AuthorUrl: '',
			Caption: ''
		};

		for (const [i, line] of input.entries()) {
			if (i !== 0) {
				const matches = line.match(/(\w+): (.+)/);
				if (matches === null) {
					return info;
				}
				const key = matches[1];
				const val = matches[2];

				parsedInput[key as keyof typeof parsedInput] = val;
			}
			else {
				parsedInput['Url'] = input[0];
			}
		}

		// Check each item is filled
		for (const key in parsedInput) {
			if (Object.prototype.hasOwnProperty.call(parsedInput, key)) {
				const value = parsedInput[key as keyof typeof parsedInput];
				if (!value || value === '') {
					return info;
				}
			}
		}

		info.url = parsedInput['Url'];
		info.video = parsedInput['Video'];
		info.thumbnail = parsedInput['Thumbnail'];
		info.vidFound = true;
		info.author = parsedInput['Author'];
		info.authorUrl = parsedInput['AuthorUrl'];
		info.caption = parsedInput['Caption'].replace(/\\n/g, '\n');

		if (this.pathIsLocal(info.video)) {
			const existingFile = this.app.vault.getAbstractFileByPath(info.video);
			if (existingFile) {
				info.videoSaved = true;
			}
		}
		if (this.pathIsLocal(info.thumbnail)) {
			const existingFile = this.app.vault.getAbstractFileByPath(info.thumbnail);
			if (existingFile) {
				info.imageSaved = true;
			}
		}

		return info;
	}

	async storeVideoInfo(info: ReelInfo, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const section = ctx.getSectionInfo(el);

		if (!section) {
			return;
		}

		if (!info.imageSaved) {
			info.thumbnail = await this.saveImage(info);
		}

		const content = `\`\`\`reel\n${info.url}\nVideo: ${info.video}\nThumbnail: ${info.thumbnail}\nAuthor: ${info.author}\nAuthorUrl: ${info.authorUrl}\nCaption: ${info.caption.replace(/\n/g, '\\n')}\n\`\`\``;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const startPos: EditorPosition = {
				line: section.lineStart,
				ch: 0
			};

			const endPos: EditorPosition = {
				line: section.lineEnd,
				ch: view.editor.getLine(section.lineEnd).length
			}

			view.editor.replaceRange(content, startPos, endPos);
		}
	}
	
	async getVideoFolder(): Promise<string> {
		if (this.settings.videoLocationMode === 'defaultAttachment') {
			//@ts-ignore
			return this.app.vault.getConfig('attachmentFolderPath');
			// method source: https://forum.obsidian.md/t/api-get-the-directory-of-the-default-location-for-new-attachments-setting/36847/2
			//@ts-ignore
			// return await this.app.vault.getAvailablePathForAttachments(id, 'jpg', currentNote);
		}
		return this.settings.customFolderPath;
	}

	async saveImage(info: ReelInfo): Promise<string> {
		// Save image and return path, or url if save failed

		// TODO
		// - getAvailablePathForAttachment gives indexed file locations when file exists, exisiting file check misses relative paths
		// - Make relative paths work for "specified folder" setting
		//   - As is relative paths in `filePath` turn out relative to vault root
		const id = await this.getVideoId(info.url);
		let filePath = '';

		const currentNote = this.app.workspace.getActiveFile();
/*
		if (this.settings.videoLocationMode === 'specifiedFolder') {
			filePath = `${this.settings.customFolderPath}/${id}.jpg`;
		} else {
			//@ts-ignore
			// let attachmentPath = this.app.vault.getConfig('attachmentFolderPath');
			// If last character is '/', trim it
			// if(attachmentPath.substring(attachmentPath.length - 1) === '/'){
			// 	attachmentPath = attachmentPath.substring(0, attachmentPath.length - 1);
			// }
			// filePath = `${attachmentPath}/${id}.jpg`;

			//@ts-ignore
			filePath = await this.app.vault.getAvailablePathForAttachments(id, 'jpg', currentNote);


			//Regex to remove number from end of path from `getAvailablePathForAttachments`
			const pathRegex = /(.*) \d+\.jpg/;
			filePath = filePath.replace(pathRegex, '$1.jpg');
		} */
		const folder = await this.getVideoFolder();
		filePath = `${folder}/${id}.jpg`;

		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		// this check isn't catching relative subfolder paths


		if (existingFile) {
			// file exists
			return existingFile.path;
		}

		const folderMatch = filePath.match(/(.+)\/.+\.jpg/);
		if(folderMatch){
			const folderPath = folderMatch[1];

			const existingFolder = this.app.vault.getAbstractFileByPath(folderPath);

			if (this.settings.videoLocationMode === 'specifiedFolder' && !existingFolder) {
				new Notice(`Thumbnails: The folder you specified (${this.settings.customFolderPath}) does not exist.`);
				return info.thumbnail;
			}
		}

		const reqParam: RequestUrlParam = {
			url: info.thumbnail
		}

		let file: TFile;

		try {
			const req = await requestUrl(reqParam);

			if (req.status === 200) {
				// Relative paths in `filePath` turn out relative to vault root
				file = await this.app.vault.createBinary(filePath, req.arrayBuffer);
			}
			else{
				// HTTP fail
			}
		} catch (error) {
			// If error when saving, just return thumbnail url
			console.log(error);

			return info.thumbnail;
		}


		if(file){
			const localUrl = file.path;
			return localUrl;
		}

		return info.thumbnail;
	}

	getTrimmedResourcePath(file: TAbstractFile): string {
		//@ts-ignore
		const path = this.app.vault.getResourcePath(file);
		const endPos = path.indexOf('.jpg') + 4;
		return path.substring(0, endPos);
	}

	removeStoredInfo(info: ReelInfo, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const section = ctx.getSectionInfo(el);

		if (!section) {
			return;
		}

		const content = `\`\`\`reel\n${info.url}\n\`\`\``;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const startPos: EditorPosition = {
				line: section.lineStart,
				ch: 0
			};

			const endPos: EditorPosition = {
				line: section.lineEnd,
				ch: view.editor.getLine(section.lineEnd).length
			}

			view.editor.replaceRange(content, startPos, endPos);
		}
	}

	async getVideoInfo(url: string): Promise<ReelInfo> {
		const info: ReelInfo = {
			url: url,
			thumbnail: '',
			video: '',
			vidFound: false,
			networkError: false,
			videoSaved: false,
			imageSaved: false,
			author: '',
			authorUrl: '',
			caption: ''
		};

		let isInstagram = false;
		for (const type of URL_TYPES.instagram) {
			if (url.includes(type.match)) {
				isInstagram = true;
			}
		}

		if (isInstagram) {
			try {
				const folder = await this.getVideoFolder();
				const result = await downloadInstagramReel(url, folder, false, this.app.vault);
				if (result.success) {
					info.vidFound = true;
					info.thumbnail = result.thumbnailPath;
					info.video = result.filePath;
					info.author = result.postInfo.owner_fullname || 'Unknown';
					info.authorUrl = `https://instagram.com/${result.postInfo.owner_username}`;
					info.caption = result.caption;
				}
			} catch (error) {
				console.error("Failed to download Instagram reel:", error);
				info.networkError = true;
			}
			return info;
		}

		//reel not found
		return info;
	}

	async getVideoId(url: string): Promise<string> {
		let id = '';
		const instagramType = URL_TYPES.instagram[0];
		if (url.includes(instagramType.match)) {
			const matches = url.match(instagramType.idPattern);
			if (matches !== null) {
				id = matches[1];
			}
		}
		return id;
	}
}
