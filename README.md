# YouTube to Obsidian

An Obsidian plugin that fetches YouTube video transcripts and creates AI-powered summaries using OpenAI's GPT models.

## Features

- Automatically detects YouTube URLs in your notes
- Fetches English transcripts for all detected videos
- Generates concise summaries using OpenAI's GPT models
- Organizes summaries under a "YouTube Transcripts" section
- Customizable summarization prompt
- Supports multiple YouTube URL formats (youtube.com/watch, youtu.be, youtube.com/embed)

## Installation

1. Download the latest release from the releases page
2. Extract the files to your Obsidian plugins folder: `.obsidian/plugins/youtube2obsidian/`
3. Enable the plugin in Obsidian's settings
4. Add your OpenAI API key in the plugin settings

## Usage

1. Add YouTube URLs to your note
2. Open the command palette (Ctrl/Cmd + P)
3. Search for "Summarize YouTube Transcripts"
4. The plugin will:
   - Fetch transcripts for all videos
   - Generate summaries using OpenAI
   - Add summaries under a "YouTube Transcripts" section

## Settings

- **OpenAI API Key**: Required for generating summaries
- **Summary Prompt**: Customize how the AI should summarize the transcripts
- **Max Tokens**: Control the length of generated summaries
- **Model**: Choose between GPT-3.5 Turbo and GPT-4

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/youtube2obsidian.git

# Install dependencies
npm install

# Build the plugin
npm run build
```

## License

MIT License
