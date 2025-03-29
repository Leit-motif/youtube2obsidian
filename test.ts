import { getSubtitles } from 'youtube-caption-scraper';

async function testTranscriptFetching() {
    try {
        const videoId = 'eIho2S0ZahI';
        console.log('Fetching transcript for video:', videoId);
        
        const subtitles = await getSubtitles({
            videoID: videoId,
            lang: 'en'
        });
        
        console.log('Transcript fetched successfully!');
        console.log('First few lines:');
        console.log(subtitles.slice(0, 5).map(item => item.text).join('\n'));
        
    } catch (error) {
        console.error('Error fetching transcript:', error);
    }
}

testTranscriptFetching(); 