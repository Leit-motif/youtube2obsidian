# YouTube to Obsidian

An Obsidian plugin that fetches YouTube video transcripts and creates AI-powered summaries using OpenAI's GPT models.

## Features

- Quick access via YouTube ribbon icon in the left sidebar
- Automatically detects YouTube URLs in your notes
- Fetches English transcripts for all detected videos (prioritizes US English)
- Generates concise summaries using OpenAI's GPT models
- Organizes summaries under a "YouTube Transcripts" section
- Advanced transcript cleaning:
  - Proper handling of HTML entities
  - Smart handling of acronyms and punctuation
  - Removal of timestamps and filler words
  - Improved sentence structure and readability
- Customizable summarization prompt
- Supports multiple YouTube URL formats (youtube.com/watch, youtu.be, youtube.com/embed)

## Installation

1. Download the latest release from the releases page
2. Extract the files to your Obsidian plugins folder: `.obsidian/plugins/youtube2obsidian/`
3. Enable the plugin in Obsidian's settings
4. Add your OpenAI API key in the plugin settings

## Usage

There are two ways to use the plugin:

1. Using the Ribbon Icon:
   - Click the YouTube icon in the left sidebar
   - The plugin will process all YouTube URLs in the current note

2. Using the Command Palette:
   - Open the command palette (Ctrl/Cmd + P)
   - Search for "Summarize YouTube Transcripts"
   - Select the command to process all URLs

The plugin will:
- Fetch transcripts for all videos
- Clean and format the transcripts for better readability
- Generate summaries using OpenAI
- Add summaries under a "YouTube Transcripts" section

## Settings

- **OpenAI API Key**: Required for generating summaries
- **Summary Prompt**: Customize how the AI should summarize the transcripts
- **Max Tokens**: Control the length of generated summaries
- **Model**: Choose between GPT-3.5 Turbo and GPT-4
- **CORS Proxy**: Configure the CORS proxy URL for fetching transcripts (default: corsproxy.io)

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/youtube2obsidian.git

# Install dependencies
npm install

# Build the plugin
npm run build
```

## Troubleshooting

If you encounter issues:

1. **No Transcripts Available**: Make sure the video has closed captions enabled
2. **API Key Error**: Verify your OpenAI API key in the plugin settings
3. **CORS Issues**: Try changing the CORS proxy URL in settings
4. **Empty Summaries**: Check the console (Ctrl/Cmd + Shift + I) for detailed logs

## License

MIT License