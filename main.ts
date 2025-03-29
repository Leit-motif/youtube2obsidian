import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import OpenAI from 'openai';

interface Youtube2ObsidianSettings {
	openAIApiKey: string;
	maxTokens: number;
	model: string;
	summaryPrompt: string;
	corsProxy: string;
}

const DEFAULT_SETTINGS: Youtube2ObsidianSettings = {
	openAIApiKey: '',
	maxTokens: 500,
	model: 'gpt-4o',
	summaryPrompt: 'Create a concise bullet-point summary of the following video transcript, highlighting the key points and main ideas:',
	corsProxy: 'https://corsproxy.io/?'
}

function decodeHtmlEntities(text: string): string {
	const textarea = document.createElement('textarea');
	
	// First pass: handle common HTML entities
	let decoded = text.replace(/&([^;]+);/g, (match, entity) => {
		textarea.innerHTML = match;
		return textarea.value;
	});

	// Second pass: handle numeric entities
	decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
		return String.fromCharCode(parseInt(dec, 10));
	});

	// Third pass: handle hex entities
	decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
		return String.fromCharCode(parseInt(hex, 16));
	});

	// Fourth pass: handle apostrophes and quotes specifically
	decoded = decoded
		.replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
		.replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
		.replace(/&amp;/gi, '&');

	return decoded;
}

function cleanTranscript(text: string): string {
	// First decode HTML entities
	let cleaned = decodeHtmlEntities(text);

	// Replace multiple spaces and newlines with a single space
	cleaned = cleaned.replace(/\s+/g, ' ');

	// Remove timestamps and video-specific artifacts
	cleaned = cleaned.replace(/\[\d+:\d+\]/g, ''); // Remove timestamps like [1:23]
	cleaned = cleaned.replace(/\(\d+:\d+\)/g, ''); // Remove timestamps like (1:23)
	cleaned = cleaned.replace(/\d+:\d+/g, ''); // Remove standalone timestamps

	// Fix common transcription artifacts
	cleaned = cleaned
		// Remove repeated words (including across punctuation)
		.replace(/\b(\w+)[.,!?]?\s+\1\b/gi, '$1')
		// Remove common filler words at word boundaries
		.replace(/\b(um|uh|like|so|you know|i mean|basically|actually|literally|right|okay|well)\b\s*/gi, '')
		// Fix periods around acronyms (e.g., "M.C.P." -> "MCP")
		.replace(/\b([A-Z])\.\s*([A-Z])\.\s*([A-Z])\./g, '$1$2$3')
		// Remove unnecessary punctuation repetition
		.replace(/([.,!?])[.,!?]+/g, '$1')
		// Fix spacing around punctuation
		.replace(/\s*([.,!?])\s*/g, '$1 ')
		// Add periods to likely sentence endings (when a word is followed by a capitalized word)
		.replace(/(\w)\s+([A-Z])/g, '$1. $2')
		// Fix "I" capitalization
		.replace(/\bi\b/g, 'I')
		// Remove extra spaces
		.trim();

	// Ensure proper sentence capitalization and spacing
	cleaned = cleaned.split(/[.!?]\s+/).map(sentence => {
		sentence = sentence.trim();
		if (sentence.length === 0) return '';
		
		// Don't capitalize acronyms or proper nouns that are already capitalized
		if (/^[A-Z]+$/.test(sentence.split(' ')[0])) {
			return sentence;
		}
		return sentence.charAt(0).toUpperCase() + sentence.slice(1);
	}).join('. ').trim();

	// Final cleanup
	cleaned = cleaned
		// Ensure single space after periods
		.replace(/\.\s+/g, '. ')
		// Remove any resulting double periods
		.replace(/\.\./g, '.')
		// Fix spacing after final cleanup
		.trim();

	return cleaned;
}

interface TranscriptItem {
	text: string;
	duration: number;
	offset: number;
}

interface CaptionTrack {
	baseUrl: string;
	languageCode: string;
	kind?: string;
	name?: {
		simpleText: string;
	};
}

export default class Youtube2Obsidian extends Plugin {
	settings: Youtube2ObsidianSettings;
	openai: OpenAI | undefined;
	originalFetch: typeof fetch;

	async onload() {
		await this.loadSettings();

		// Initialize OpenAI client
		this.openai = new OpenAI({
			apiKey: this.settings.openAIApiKey,
			dangerouslyAllowBrowser: true
		});

		// Add ribbon icon
		this.addRibbonIcon(
			'youtube',
			'Summarize YouTube Videos',
			async (evt: MouseEvent) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					await this.summarizeYouTubeVideos(activeView.editor);
				} else {
					new Notice('Please open a markdown file first');
				}
			}
		);

		// Override global fetch for youtube-transcript
		this.originalFetch = window.fetch.bind(window);
		const proxiedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			// If it's a caption request, bypass the proxy and add required headers
			if (typeof input === 'string' && input.includes('/api/timedtext')) {
				const captionsInit = {
					...init,
					headers: {
						...init?.headers,
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'Accept-Language': 'en-US,en;q=0.9',
						'Origin': 'https://www.youtube.com',
						'Referer': 'https://www.youtube.com/',
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
					}
				};
				console.log('Direct caption request:', {
					url: input,
					headers: captionsInit.headers
				});
				return this.originalFetch(input, captionsInit);
			}

			if (typeof input === 'string' && (input.includes('youtube.com') || input.includes('noembed.com'))) {
				const proxyUrl = this.settings.corsProxy + encodeURIComponent(input);
				console.log('Proxying request:', {
					original: input,
					proxied: proxyUrl,
					headers: init?.headers
				});
				
				// Add required headers for YouTube requests
				const newInit = {
					...init,
					headers: {
						...init?.headers,
						'Origin': 'https://www.youtube.com',
						'Referer': 'https://www.youtube.com/',
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'Accept-Language': 'en-US,en;q=0.9',
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
					}
				};
				
				const response = await this.originalFetch(proxyUrl, newInit);
				const headerObj: Record<string, string> = {};
				response.headers.forEach((value, key) => {
					headerObj[key] = value;
				});
				
				console.log('Proxy response:', {
					status: response.status,
					statusText: response.statusText,
					headers: headerObj
				});
				
				// Log response body for debugging
				const clonedResponse = response.clone();
				try {
					const text = await clonedResponse.text();
					console.log('Response body:', text);
				} catch (e) {
					console.log('Could not log response body:', e);
				}
				
				return response;
			}
			return this.originalFetch(input, init);
		};

		window.fetch = proxiedFetch.bind(window);

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

	private async getVideoTitle(videoId: string): Promise<string> {
		try {
			// Remove any trailing = and timestamp parameters
			const cleanVideoId = videoId.replace(/[&?]t=.*$/, '').replace(/=+$/, '');
			
			// Try fetching directly from YouTube first
			const youtubeResponse = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${cleanVideoId}&format=json`);
			if (youtubeResponse.ok) {
				const data = await youtubeResponse.json();
				return data.title || `Video ${cleanVideoId}`;
			}
			
			// Fallback to noembed if YouTube fails
			const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${cleanVideoId}`);
			const data = await response.json();
			return data.title || `Video ${cleanVideoId}`;
		} catch (error) {
			console.error('Error fetching video title:', error);
			return `Video ${videoId}`;
		}
	}

	private async processVideos(videoIds: string[]): Promise<Map<string, { title: string, summary: string }>> {
		const results = new Map();

		for (const videoId of videoIds) {
			try {
				console.log(`Processing video ${videoId}...`);
				
				// Clean the video ID by removing timestamp and other parameters
				const cleanVideoId = videoId.replace(/[&?]t=.*$/, '').replace(/=+$/, '');
				console.log(`Using cleaned video ID: ${cleanVideoId}`);
				
				// First try to get the video title
				const title = await this.getVideoTitle(cleanVideoId);
				
				// Fetch the video page to get player data
				console.log('Fetching video page...');
				const videoUrl = `https://www.youtube.com/watch?v=${cleanVideoId}`;
				const videoPageResponse = await fetch(videoUrl);
				const videoPageBody = await videoPageResponse.text();

				// Extract player data
				const playerDataMatch = videoPageBody.match(/var ytInitialPlayerResponse = ({.+?});/);
				if (!playerDataMatch) {
					throw new Error('Could not find player data');
				}

				// Parse player data
				const playerData = JSON.parse(playerDataMatch[1]);
				console.log('Successfully extracted player data');

				// Get caption tracks
				const captionTracks: CaptionTrack[] = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
				if (!captionTracks.length) {
					throw new Error('No caption tracks available');
				}

				console.log('Available caption tracks:', captionTracks.map(track => ({
					languageCode: track.languageCode,
					kind: track.kind,
					name: track.name,
					baseUrl: track.baseUrl
				})));

				// Try to find English captions, prioritizing US English
				const captionTrack = captionTracks.find(track => track.languageCode === 'en-US') ||
									captionTracks.find(track => track.languageCode === 'en') ||
									captionTracks[0];

				if (!captionTrack) {
					throw new Error('No suitable caption track found');
				}

				console.log('Selected caption track:', {
					languageCode: captionTrack.languageCode,
					kind: captionTrack.kind,
					name: captionTrack.name,
					baseUrl: captionTrack.baseUrl
				});

				// Use the exact baseUrl from the track
				const captionsUrl = captionTrack.baseUrl;
				console.log('Fetching captions from:', captionsUrl);

				// Add required headers for the captions request
				const captionsResponse = await fetch(captionsUrl, {
					headers: {
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'Accept-Language': 'en-US,en;q=0.9',
						'Origin': 'https://www.youtube.com',
						'Referer': 'https://www.youtube.com/',
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
					}
				});

				if (!captionsResponse.ok) {
					throw new Error(`Failed to fetch captions: ${captionsResponse.status} ${captionsResponse.statusText}`);
				}

				const captionsXML = await captionsResponse.text();
				console.log('Captions XML (first 500 chars):', captionsXML.substring(0, 500));

				if (!captionsXML.trim()) {
					throw new Error('Received empty response from captions API');
				}

				// Parse XML
				const parser = new DOMParser();
				const xmlDoc = parser.parseFromString(captionsXML, 'text/xml');
				const textElements = xmlDoc.getElementsByTagName('text');

				if (!textElements.length) {
					throw new Error('No transcript elements found in XML');
				}

				// Convert to transcript items
				const transcriptItems: TranscriptItem[] = Array.from(textElements).map(element => ({
					text: decodeHtmlEntities(element.textContent || ''),
					duration: parseFloat(element.getAttribute('dur') || '0') * 1000,
					offset: parseFloat(element.getAttribute('start') || '0') * 1000
				}));

				console.log(`Got transcript for "${title}" with ${transcriptItems.length} items`);
				
				// Clean the transcript before joining
				const cleanedTranscript = cleanTranscript(
					transcriptItems
						.map(item => item.text)
						.join(' ')
				);
				
				console.log('Clean transcript (first 100 chars):', cleanedTranscript.substring(0, 100));
				const summary = await this.summarizeTranscript(cleanedTranscript);
				
				results.set(videoId, {
					title,
					summary
				});
			} catch (error) {
				console.error(`Error processing video ${videoId}:`, error);
				results.set(videoId, {
					title: await this.getVideoTitle(videoId),
					summary: `Error: ${error.message}`
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
			const prompt = `${this.settings.summaryPrompt}\n\nTranscript:\n${transcript}`;
			console.log('Sending prompt to OpenAI:', prompt);

			const completion = await this.openai.chat.completions.create({
				model: this.settings.model,
				messages: [
					{
						role: "system",
						content: "You are a helpful assistant that creates concise summaries of video transcripts."
					},
					{
						role: "user",
						content: prompt
					}
				],
				max_tokens: this.settings.maxTokens,
				temperature: 0.7,
			});

			console.log('OpenAI response:', completion.choices[0]?.message?.content);
			const summary = completion.choices[0]?.message?.content || 'No summary available';
			if (summary === 'No summary available' || summary.includes("Please provide the video transcript")) {
				throw new Error('Failed to generate summary: Invalid response from OpenAI');
			}
			return summary;
		} catch (error) {
			console.error('Error in summarizeTranscript:', error);
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
			for (const [videoId, data] of summaries) {
				if (sectionContent.includes(`### ${data.title}`)) {
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
		// Restore original fetch
		if (this.originalFetch) {
			window.fetch = this.originalFetch;
		}
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

	private async summarizeYouTubeVideos(editor: Editor) {
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
				.addOption('gpt-4o', 'GPT-4o (Fastest & Cost-effective)')
				.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo (Most Economical)')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('CORS Proxy')
			.setDesc('URL of the CORS proxy to use (include ? at the end)')
			.addText(text => text
				.setPlaceholder('https://corsproxy.io/?')
				.setValue(this.plugin.settings.corsProxy)
				.onChange(async (value) => {
					this.plugin.settings.corsProxy = value;
					await this.plugin.saveSettings();
				}));
	}
}