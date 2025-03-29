const { YoutubeTranscript } = require('youtube-transcript');

function decodeHtmlEntities(text) {
    const entities = {
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

async function testTranscriptFetching() {
    try {
        const videoId = 'eIho2S0ZahI';
        console.log('Fetching transcript for video:', videoId);
        
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en'  // Request English captions
        });
        
        console.log('Transcript fetched successfully!');
        console.log('First few lines:');
        const cleanTranscript = transcriptItems.map(item => ({
            ...item,
            text: decodeHtmlEntities(item.text)
        }));
        console.log(cleanTranscript.slice(0, 5).map(item => item.text).join('\n'));
        
    } catch (error) {
        console.error('Error fetching transcript:', error);
    }
}

testTranscriptFetching(); 