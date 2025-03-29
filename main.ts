import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';

interface Youtube2ObsidianSettings {
	openAIApiKey: string;
	maxTokens: number;
	model: string;
	summaryPrompt: string;
}

const DEFAULT_SETTINGS: Youtube2ObsidianSettings = {
	openAIApiKey: '',
	maxTokens: 500,
	model: 'gpt-3.5-turbo',
	summaryPrompt: 'Create a concise bullet-point summary of the following video transcript, highlighting the key points and main ideas:'
}

function decodeHtmlEntities(text: string): string {
	const entities: { [key: string]: string } = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': "'",
		'&amp;#39;': "'",
		'&amp;quot;': '"'
	};
	return text.replace(/&amp;#39;|&amp;quot;|&amp;[^;]+;/g, match => entities[match] || match);
}

function extractVideoId(url: string): string | null {
	const patterns = [
		/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
		/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]+)/,
		/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}
	return null;
}

export default class Youtube2Obsidian extends Plugin {
	settings: Youtube2ObsidianSettings;
	openai: OpenAI | undefined;

	async onload() {
		await this.loadSettings();

		// Initialize OpenAI client
		this.openai = new OpenAI({
			apiKey: this.settings.openAIApiKey,
			dangerouslyAllowBrowser: true
		});

		this.addCommand({
			id: 'summarize-youtube-transcripts',
			name: 'Summarize YouTube Transcripts',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.settings.openAIApiKey) {
					new Notice('Please set your OpenAI API key in the plugin settings');
					return;
				}

				const content = editor.getValue();
				const videoIds = this.extractAllVideoIds(content);

				if (videoIds.length === 0) {
					new Notice('No YouTube URLs found in the current note');
					return;
				}

				new Notice(`Processing ${videoIds.length} video(s)...`);

				try {
					const summaries = await this.processVideos(videoIds);
					this.updateNote(editor, summaries);
					new Notice('Successfully processed all videos!');
				} catch (error) {
					console.error('Error processing videos:', error);
					new Notice('Error processing videos. Check console for details.');
				}
			}
		});

		this.addSettingTab(new Youtube2ObsidianSettingTab(this.app, this));
	}

	private extractAllVideoIds(content: string): string[] {
		const patterns = [
			/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&\s]+)/g,
			/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?\s]+)/g,
			/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?\s]+)/g
		];

		const videoIds = new Set<string>();
		for (const pattern of patterns) {
			const matches = content.matchAll(pattern);
			for (const match of matches) {
				videoIds.add(match[1]);
			}
		}

		return Array.from(videoIds);
	}

	private async processVideos(videoIds: string[]): Promise<Map<string, { title: string, summary: string }>> {
		const results = new Map();

		for (const videoId of videoIds) {
			try {
				const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
					lang: 'en'
				});

				const cleanTranscript = transcriptItems
					.map(item => decodeHtmlEntities(item.text))
					.join(' ');

				const summary = await this.summarizeTranscript(cleanTranscript);
				results.set(videoId, {
					title: `Video ${videoId}`, // We can enhance this later to fetch actual titles
					summary
				});
			} catch (error) {
				console.error(`Error processing video ${videoId}:`, error);
				results.set(videoId, {
					title: `Video ${videoId}`,
					summary: `Error: Failed to process video (${error.message})`
				});
			}
		}

		return results;
	}

	private async summarizeTranscript(transcript: string): Promise<string> {
		if (!this.openai) {
			throw new Error('OpenAI client not initialized');
		}

		try {
			const completion = await this.openai.chat.completions.create({
				model: this.settings.model,
				messages: [
					{
						role: "system",
						content: "You are a helpful assistant that creates concise summaries of video transcripts."
					},
					{
						role: "user",
						content: `${this.settings.summaryPrompt}\n\n${transcript}`
					}
				],
				max_tokens: this.settings.maxTokens,
				temperature: 0.7,
			});

			return completion.choices[0]?.message?.content || 'No summary available';
		} catch (error) {
			throw new Error(`Failed to generate summary: ${error.message}`);
		}
	}

	private updateNote(editor: Editor, summaries: Map<string, { title: string, summary: string }>) {
		const content = editor.getValue();
		const lines = content.split('\n');
		
		// Find existing YouTube Transcripts section
		let sectionStart = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === '## YouTube Transcripts') {
				sectionStart = i;
				break;
			}
		}

		// Get existing video IDs in the section
		const existingVideoIds = new Set<string>();
		if (sectionStart !== -1) {
			const sectionContent = lines.slice(sectionStart).join('\n');
			for (const [videoId] of summaries) {
				if (sectionContent.includes(`### Video ${videoId}`)) {
					existingVideoIds.add(videoId);
				}
			}
		}

		// Prepare new summaries
		let newContent = '';
		if (sectionStart === -1) {
			// Create new section
			newContent = '\n\n## YouTube Transcripts\n\n';
		} else {
			// Append to existing section
			newContent = '\n';
		}

		// Add new summaries
		for (const [videoId, data] of summaries) {
			if (!existingVideoIds.has(videoId)) {
				newContent += `### ${data.title}\n\n${data.summary}\n\n`;
			}
		}

		// Insert content
		if (sectionStart === -1) {
			// Add at the end of the note
			editor.replaceRange(newContent, { line: lines.length, ch: 0 });
		} else {
			// Add after the section header
			editor.replaceRange(newContent, { line: sectionStart + 1, ch: 0 });
		}
	}

	onunload() {
		// Cleanup
		this.openai = undefined;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Reinitialize OpenAI client with new settings
		this.openai = new OpenAI({
			apiKey: this.settings.openAIApiKey,
			dangerouslyAllowBrowser: true
		});
	}
}

class Youtube2ObsidianSettingTab extends PluginSettingTab {
	plugin: Youtube2Obsidian;

	constructor(app: App, plugin: Youtube2Obsidian) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'YouTube to Obsidian Settings' });

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for summarization (required)')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.openAIApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openAIApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Summary Prompt')
			.setDesc('Customize the prompt used for summarizing transcripts')
			.addTextArea(text => text
				.setPlaceholder(DEFAULT_SETTINGS.summaryPrompt)
				.setValue(this.plugin.settings.summaryPrompt)
				.onChange(async (value) => {
					this.plugin.settings.summaryPrompt = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Tokens')
			.setDesc('Maximum number of tokens for the summary')
			.addText(text => text
				.setPlaceholder('500')
				.setValue(String(this.plugin.settings.maxTokens))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue)) {
						this.plugin.settings.maxTokens = numValue;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('OpenAI model to use for summarization')
			.addDropdown(dropdown => dropdown
				.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
				.addOption('gpt-4', 'GPT-4')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
	}
}
