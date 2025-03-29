declare module 'youtube-transcript-api' {
    interface TranscriptItem {
        text: string;
        duration: number;
        offset: number;
        lang: string;
    }

    export class TranscriptAPI {
        static getTranscript(videoId: string): Promise<TranscriptItem[]>;
    }
}

declare module 'youtube-caption-scraper' {
    interface SubtitleItem {
        text: string;
        start: number;
        duration: number;
    }

    interface GetSubtitlesOptions {
        videoID: string;
        lang?: string;
    }

    export function getSubtitles(options: GetSubtitlesOptions): Promise<SubtitleItem[]>;
} 