export type WordSearchMode = 'standard' | 'scrambler' | 'mystery';

export interface GameCatalogItem {
    id: number;
    slug: string;
    name: string;
    tagline: string;
    cadence: string;
    required_unlock: string | null;
    config: Record<string, unknown> | null;
}

export interface UserProfile {
    id: number;
    display_name: string;
    unlocks: string[];
}

export interface WordCategory {
    slug: string;
    name: string;
}

export interface WordSearchPuzzle {
    id: number;
    share_code: string;
    variant: WordSearchMode;
    source: 'official' | 'on_demand' | 'custom_friend';
    title: string;
    theme_hint: string | null;
    starts_on: string | null;
    words: string[];
    seed: string;
    scramble_interval_seconds: number;
}

export interface FoxHuntSlot {
    index: number;
    word: string | null;
    locked_by: 'daily_clue' | 'player' | null;
}

export interface FoxHuntStateResponse {
    puzzle: {
        id: number;
        share_code: string;
        title: string;
        theme_hint: string | null;
        starts_on: string | null;
        ends_on: string | null;
        is_current_week: boolean;
        can_fast_forward: boolean;
    };
    progress: {
        status: 'in_progress' | 'won' | 'lost';
        day_index: number;
        today_guess_used: boolean;
        slots: FoxHuntSlot[];
        misplaced_words: string[];
        eliminated_words: string[];
    };
}

export interface FoxHuntArchiveItem {
    id: number;
    share_code: string;
    title: string;
    theme_hint: string | null;
    starts_on: string;
    ends_on: string;
}

export interface ApiValidationError extends Error {
    status: number;
    invalidSlots?: Array<{ index: number; word: string }>;
}

export interface PlayerStatsResponse {
    word_search_cleared: number;
    best_search_seconds: number | null;
    fox_hunt_won: number;
    fox_hunt_played: number;
    daily_streak: number;
}