import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFolder } from 'obsidian';
import OpenAI from 'openai';
import { fetchTranscript } from 'youtube-transcript-plus';

interface Youtube2ObsidianSettings {
	openAIApiKey: string;
	maxTokens: number;
	model: string;
	summaryPrompt: string;
	corsProxy: string;
	transcriptFolder: string;
}

const DEFAULT_SETTINGS: Youtube2ObsidianSettings = {
	openAIApiKey: '',
	maxTokens: 500,
	model: 'gpt-4o',
	summaryPrompt: 'Create a concise bullet-point summary of the following video transcript, highlighting the key points and main ideas:',
	corsProxy: 'https://corsproxy.io/?',
	transcriptFolder: 'YouTube Transcripts'
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
			console.log('Getting title for video ID:', cleanVideoId);
			
			// Try fetching directly from YouTube first
			const youtubeResponse = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${cleanVideoId}&format=json`);
			if (youtubeResponse.ok) {
				const data = await youtubeResponse.json();
				console.log('Got YouTube title:', data.title);
				return data.title || `Video ${cleanVideoId}`;
			}
			
			// Fallback to noembed if YouTube fails
			console.log('YouTube oembed failed, trying noembed...');
			const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${cleanVideoId}`);
			const data = await response.json();
			console.log('Got noembed title:', data.title);
			return data.title || `Video ${cleanVideoId}`;
		} catch (error) {
			console.error('Error fetching video title:', error);
			return `Video ${videoId}`;
		}
	}

	private async processVideos(videoIds: string[]): Promise<Map<string, { title: string, summary: string, transcript: string }>> {
		const results = new Map();

		for (const videoId of videoIds) {
			try {
				console.log(`Processing video ${videoId}...`);

				// Clean the video ID by removing timestamp and other parameters
				const cleanVideoId = videoId.replace(/[&?]t=.*$/, '').replace(/=+$/, '');
				console.log(`Using cleaned video ID: ${cleanVideoId}`);

				// First try to get the video title
				const title = await this.getVideoTitle(cleanVideoId);
				console.log('Retrieved title for video:', title);
				
				const customFetch = async (url: string) => {
					const proxyUrl = this.settings.corsProxy + encodeURIComponent(url);
					console.log('Proxying request via custom fetch:', {
						original: url,
						proxied: proxyUrl,
					});
				
					const response = await fetch(proxyUrl, {
						headers: {
							'Origin': 'https://www.youtube.com',
							'Referer': 'https://www.youtube.com/',
							'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
							'Accept-Language': 'en-US,en;q=0.9',
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
						}
					});
					return response;
				};

				// Fetch transcript using the library
				const transcriptItems: TranscriptItem[] = await fetchTranscript(cleanVideoId, {
					lang: 'en',
					videoFetch: ({ url }) => customFetch(url),
					transcriptFetch: ({ url }) => customFetch(url)
				});

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
					summary,
					transcript: cleanedTranscript
				});
			} catch (error) {
				console.error(`Error processing video ${videoId}:`, error);
				const errorMessage = `Error fetching transcript: ${error instanceof Error ? error.message : 'Unknown error'}`;
				results.set(videoId, {
					title: await this.getVideoTitle(videoId),
					summary: errorMessage,
					transcript: ''
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
				if (error instanceof Error && 
					typeof error.message === 'string' && 
					error.message.includes('Request too large')) {
					// Extract requested tokens from error message
					const match = error.message.match(/Requested (\d+)/);
					const requestedTokens = match ? parseInt(match[1]) : undefined;
					console.log('Token limit exceeded, using recursive summarization with', requestedTokens, 'tokens');
					console.log('Starting recursive summarization...');
					return await this.recursiveSummarize(transcript, requestedTokens);
				}
				throw error;
			}
		} catch (error) {
			console.error('Error in summarizeTranscript:', error);
			throw error instanceof Error ? error : new Error('Unknown error in summarizeTranscript');
		}
	}

	private async recursiveSummarize(transcript: string, requestedTokens?: number): Promise<string> {
		if (!this.openai) {
			throw new Error('OpenAI client not initialized');
		}

		try {
			// Calculate optimal chunk size based on the token error if available
			// GPT-3.5-turbo has a 16k token limit, so we'll aim for ~12k tokens per chunk to be safe
			const tokenLimit = 12000;
			// Estimate tokens (rough approximation: 1 token ≈ 4 characters)
			const estimatedTokens = transcript.length / 4;
			const numChunks = Math.max(Math.ceil(estimatedTokens / tokenLimit), requestedTokens ? Math.ceil(requestedTokens / tokenLimit) : 1);
			const approximateChunkSize = Math.floor(transcript.length / numChunks);

			console.log(`Recursive summarization: Splitting into ${numChunks} chunks of ~${approximateChunkSize} characters each`);

			const chunks: string[] = [];
			let currentPosition = 0;

			// Split into chunks at sentence boundaries
			while (currentPosition < transcript.length) {
				let endPosition = Math.min(currentPosition + approximateChunkSize, transcript.length);
				
				// Find the last sentence boundary (period, exclamation mark, or question mark followed by space)
				if (endPosition < transcript.length) {
					const searchText = transcript.slice(endPosition - 100, endPosition + 100);
					const lastSentenceMatch = searchText.match(/[.!?]\s+/g);
					if (lastSentenceMatch) {
						const lastMatch = lastSentenceMatch[lastSentenceMatch.length - 1];
						const matchIndex = searchText.lastIndexOf(lastMatch);
						endPosition = endPosition - 100 + matchIndex + lastMatch.length;
					}
				}

				chunks.push(transcript.slice(currentPosition, endPosition).trim());
				currentPosition = endPosition;
			}

			console.log(`Created ${chunks.length} chunks for processing`);

			// Store openai reference
			const openai = this.openai;
			const summaries: string[] = [];

			// Process chunks with delay between each to avoid rate limits
			for (let i = 0; i < chunks.length; i++) {
				try {
					console.log(`Processing chunk ${i + 1} of ${chunks.length}`);
					// Add delay between chunks to respect rate limits
					if (i > 0) {
						await new Promise(resolve => setTimeout(resolve, 2000));
					}

					const completion = await openai.chat.completions.create({
						model: "gpt-3.5-turbo-16k", // Use 16k version for better handling of long chunks
						messages: [
							{
								role: "system",
								content: "Create a very brief summary of this transcript segment, focusing only on the key points."
							},
							{
								role: "user",
								content: chunks[i]
							}
						],
						max_tokens: Math.min(2000, Math.floor(this.settings.maxTokens / 2)),
						temperature: 0.7,
					});

					const summary = completion.choices[0]?.message?.content || '';
					if (summary) {
						console.log(`Successfully summarized chunk ${i + 1}`);
						summaries.push(summary);
					}
				} catch (error) {
					console.error(`Error summarizing chunk ${i + 1}, skipping:`, error);
					// Continue with other chunks even if one fails
					continue;
				}
			}

			// If we have no summaries, throw error
			if (summaries.length === 0) {
				throw new Error('Failed to generate any chunk summaries');
			}

			console.log(`Successfully generated ${summaries.length} chunk summaries, combining for final summary...`);

			// Combine summaries in smaller groups if needed
			const combinedSummary = summaries.join('\n\n');
			
			// Final summary using GPT-4
			const completion = await openai.chat.completions.create({
				model: this.settings.model,
				messages: [
					{
						role: "system",
						content: "Create a final, cohesive bullet-point summary from these segment summaries. Focus on the main ideas and ensure the summary flows logically."
					},
					{
						role: "user",
						content: `${this.settings.summaryPrompt}\n\nSegment Summaries:\n${combinedSummary}`
					}
				],
				max_tokens: this.settings.maxTokens,
				temperature: 0.7,
			});

			const finalSummary = completion.choices[0]?.message?.content || 'Failed to generate summary';
			if (finalSummary === 'Failed to generate summary') {
				throw new Error('Failed to generate final summary');
			}

			console.log('Successfully generated final combined summary');
			return finalSummary;
		} catch (error) {
			console.error('Error in recursive summarization:', error);
			throw error instanceof Error ? error : new Error('Unknown error in recursive summarization');
		}
	}

	private async createTranscriptNote(title: string, transcript: string, videoUrl: string): Promise<string> {
		const sanitizedTitle = sanitizeFilename(title);
		const date = new Date().toISOString().split('T')[0];
		
		// Create the transcript note content with metadata and formatting
		const content = `---
title: "${title}"
url: "${videoUrl}"
date_created: ${date}
type: youtube_transcript
tags:
  - youtube
  - transcript
aliases:
  - "${title}"
---

# ${title}

${transcript.split(/[.!?]\s+/)  // Split into sentences
	.reduce((paragraphs, sentence, i) => {  // Group into paragraphs
		const paragraphIndex = Math.floor(i / 5);  // 5 sentences per paragraph
		if (!paragraphs[paragraphIndex]) paragraphs[paragraphIndex] = [];
		paragraphs[paragraphIndex].push(sentence);
		return paragraphs;
	}, [] as string[][])
	.map(paragraph => paragraph.join('. '))  // Join sentences in each paragraph
	.join('\n\n')  // Add paragraph breaks
}`;

		// Ensure the transcript folder exists
		const folderPath = this.settings.transcriptFolder;
		if (!await this.app.vault.adapter.exists(folderPath)) {
			await this.app.vault.createFolder(folderPath);
		}

		// Create or update the transcript note
		const filePath = `${folderPath}/${sanitizedTitle}.md`;
		try {
			// Check if file exists
			const exists = await this.app.vault.adapter.exists(filePath);
			if (exists) {
				// Update existing file
				await this.app.vault.adapter.write(filePath, content);
			} else {
				// Create new file
				await this.app.vault.create(filePath, content);
			}
		} catch (error) {
			console.error(`Error creating/updating transcript file: ${error}`);
			// Return the path anyway so the link can be created
		}
		
		return filePath;
	}

	private async updateNote(editor: Editor, summaries: Map<string, { title: string, summary: string, transcript: string }>) {
		let content = editor.getValue();
		
		// Process each video
		for (const [videoId, data] of summaries) {
			// Create regex patterns for different URL formats
			const patterns = [
				new RegExp(`https?:\\/\\/(www\\.)?youtube\\.com\\/watch\\?v=${videoId}([^\\s]*)`, 'g'),
				new RegExp(`https?:\\/\\/(www\\.)?youtu\\.be\\/${videoId}([^\\s]*)`, 'g'),
				new RegExp(`https?:\\/\\/(www\\.)?youtube\\.com\\/embed\\/${videoId}([^\\s]*)`, 'g')
			];

			// Find all matches of the current video URL
			let urlFound = false;
			for (const pattern of patterns) {
				const matches = content.matchAll(pattern);
				for (const match of matches) {
					urlFound = true;
					const fullUrl = match[0];
					
					// Create transcript note and get its path
					const transcriptPath = await this.createTranscriptNote(data.title, data.transcript, fullUrl);
					const transcriptLink = transcriptPath.replace('.md', '');
					
					// Create the new content block with header using video title, empty markdown link to video, summary, and transcript link at the bottom
					const newBlock = `\n## ${data.title}\n[ ](${fullUrl})\n\n${data.summary}\n\n[[${transcriptLink}|Full Transcript]]\n`;
					
					// Replace the URL with the new block instead of removing it
					if (match.index !== undefined) {
						content = content.substring(0, match.index) + newBlock + content.substring(match.index + fullUrl.length);
					}
				}
			}

			// If no URL was found but we have a summary, add it at the end
			if (!urlFound) {
				const videoUrl = `https://youtube.com/watch?v=${videoId}`;
				const transcriptPath = await this.createTranscriptNote(data.title, data.transcript, videoUrl);
				const transcriptLink = transcriptPath.replace('.md', '');
				const newBlock = `\n## ${data.title}\n[ ](${videoUrl})\n\n${data.summary}\n\n[[${transcriptLink}|Full Transcript]]\n`;
				content = content.trim() + newBlock;
			}
		}

		// Clean up any empty lines that might have been left behind
		content = content
			.split('\n')
			.filter((line, index, array) => {
				// Keep lines that have content or are part of meaningful spacing
				return line.trim() !== '' || 
					(index > 0 && array[index - 1].trim() !== '' && 
					index < array.length - 1 && array[index + 1].trim() !== '');
			})
			.join('\n');

		// Add two newlines at the end
		content = content.trim() + '\n\n';

		// Update the editor content and set cursor position
		editor.setValue(content);
		
		// Set cursor position to the end of the content
		const lines = content.split('\n');
		editor.setCursor({ line: lines.length - 1, ch: 0 });
	}

	onunload() {
		// No need to restore fetch anymore
		this.openai = undefined;
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		console.log('Loading settings:', loadedData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		console.log('Final settings after load:', this.settings);
	}

	async saveSettings() {
		console.log('Saving settings:', this.settings);
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

		console.log('Current settings when displaying:', this.plugin.settings);

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

		new Setting(containerEl)
			.setName('Transcript Folder')
			.setDesc('Choose where to save YouTube transcripts')
			.addDropdown(dropdown => {
				// Get all folders in the vault
				const folders: string[] = [];
				
				// Add default folder if it doesn't exist
				folders.push(DEFAULT_SETTINGS.transcriptFolder);
				
				// Get all folders using the proper Obsidian API
				const files = this.app.vault.getAllLoadedFiles();
				files.forEach(file => {
					if (file instanceof TFolder) {
						folders.push(file.path);
					}
				});

				// Remove duplicates and sort
				const uniqueFolders = [...new Set(folders)].sort();
				console.log('Available folders:', uniqueFolders);

				// Add folder options to dropdown
				uniqueFolders.forEach(folder => {
					dropdown.addOption(folder, folder);
				});

				// Set current value
				const currentValue = this.plugin.settings.transcriptFolder;
				console.log('Setting dropdown value to:', currentValue);
				dropdown.setValue(currentValue);

				// Handle changes
				dropdown.onChange(async (value) => {
					console.log('Folder changed to:', value);
					this.plugin.settings.transcriptFolder = value;
					await this.plugin.saveSettings();
				});
			});
	}
}

function sanitizeFilename(text: string): string {
	// Remove or replace illegal characters
	return text
		.replace(/[/\\:*?"<>|]/g, '')     // Remove illegal filesystem characters
		.replace(/\s+/g, '-')             // Replace spaces with hyphens
		.replace(/[^\w-]/g, '')           // Remove any other non-word chars except hyphens
		.replace(/-+/g, '-')              // Replace multiple hyphens with single hyphen
		.trim();
}
