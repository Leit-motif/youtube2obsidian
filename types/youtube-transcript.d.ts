declare module 'youtube-transcript' {
    interface TranscriptConfig {
        lang?: string;
    }

    interface TranscriptResponse {
        text: string;
        duration: number;
        offset: number;
        lang: string;
    }

    export class YoutubeTranscript {
        static fetchTranscript(videoId: string, config?: TranscriptConfig): Promise<TranscriptResponse[]>;
        static retrieveVideoId(videoId: string): string;
    }

    export class YoutubeTranscriptError extends Error {}
    export class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {}
    export class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {}
    export class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {}
    export class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {}
    export class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {}
} 