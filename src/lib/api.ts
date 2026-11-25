import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type {
    ApiValidationError,
    FoxHuntArchiveItem,
    FoxHuntStateResponse,
    GameCatalogItem,
    PlayerStatsResponse,
    UserProfile,
    WordCategory,
    WordSearchMode,
    WordSearchPuzzle,
} from '../types/wordfox';

WebBrowser.maybeCompleteAuthSession();

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
const GUEST_TOKEN_KEY = 'wordfox_guest_token';
const AUTH_TOKEN_KEY = 'wordfox_auth_token';

function generateGuestUuid(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const rand = Math.floor(Math.random() * 16);
        const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
        return value.toString(16);
    });
}

function parseHashParams(url: string): Record<string, string> {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) {
        return {};
    }

    const fragment = url.slice(hashIndex + 1);
    const params: Record<string, string> = {};

    for (const pair of fragment.split('&')) {
        if (!pair) continue;
        const eqIndex = pair.indexOf('=');
        if (eqIndex === -1) {
            params[decodeURIComponent(pair)] = '';
        } else {
            const key = decodeURIComponent(pair.slice(0, eqIndex));
            const value = decodeURIComponent(pair.slice(eqIndex + 1));
            params[key] = value;
        }
    }

    return params;
}

export async function getGuestToken(): Promise<string> {
    let token = await AsyncStorage.getItem(GUEST_TOKEN_KEY);
    if (!token) {
        token = generateGuestUuid();
        await AsyncStorage.setItem(GUEST_TOKEN_KEY, token);
    }
    return token;
}

export async function getAuthToken(): Promise<string | null> {
    return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function setAuthToken(token: string | null): Promise<void> {
    if (token) {
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
        await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Guest-Token': await getGuestToken(),
        ...(options.headers as Record<string, string> | undefined),
    };

    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const authToken = await getAuthToken();
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 401) {
            await setAuthToken(null);
        }

        const err = new Error(data.message || 'Request failed.') as ApiValidationError;
        err.status = response.status;
        if (Array.isArray(data.invalid_slots)) {
            err.invalidSlots = data.invalid_slots;
        }
        throw err;
    }

    return data as T;
}

export async function signInWithGoogle(): Promise<{ ok: boolean; cancelled: boolean }> {
    const redirectUri = Linking.createURL('auth/callback');
    const loginUrl = `${API_URL}/auth/google/redirect?redirect_uri=${encodeURIComponent(redirectUri)}`;

    const result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUri);

    if (result.type !== 'success' || !result.url) {
        return { ok: false, cancelled: true };
    }

    const params = parseHashParams(result.url);

    if (params.error) {
        throw new Error('Google sign-in failed. Please try again.');
    }

    if (!params.token) {
        return { ok: false, cancelled: false };
    }

    await setAuthToken(params.token);

    try {
        await apiFetch('/auth/claim-guest', {
            method: 'POST',
            body: JSON.stringify({ guest_token: await getGuestToken() }),
        });
    } catch {
        // Non-fatal if there were no guest attempts to merge
    }

    return { ok: true, cancelled: false };
}

export async function fetchGames(): Promise<GameCatalogItem[]> {
    const res = await apiFetch<{ games: GameCatalogItem[] }>('/games');
    return res.games;
}

export async function fetchUserProfile(): Promise<UserProfile | null> {
    const token = await getAuthToken();
    if (!token) return null;
    try {
        return await apiFetch<UserProfile>('/user');
    } catch {
        return null;
    }
}

export async function logoutAccount(): Promise<void> {
    const token = await getAuthToken();
    if (token) {
        try {
            await apiFetch('/auth/logout', { method: 'POST' });
        } catch {
            // Ignore network errors on sign-out
        }
    }
    await setAuthToken(null);
}

export async function fetchStats(): Promise<PlayerStatsResponse> {
    return apiFetch<PlayerStatsResponse>('/stats');
}

export async function fetchDailyWordSearch(): Promise<{
    puzzle: WordSearchPuzzle;
    categories: WordCategory[];
}> {
    return apiFetch('/word-search/daily');
}

export async function generateWordSearch(
    variant: WordSearchMode,
    categorySlug: string | null
): Promise<WordSearchPuzzle> {
    const res = await apiFetch<{ puzzle: WordSearchPuzzle }>('/word-search/generate', {
        method: 'POST',
        body: JSON.stringify({
            variant,
            category_slug: categorySlug,
        }),
    });
    return res.puzzle;
}

export async function createCustomWordSearch(
    title: string,
    variant: WordSearchMode,
    words: string[]
): Promise<WordSearchPuzzle> {
    const res = await apiFetch<{ puzzle: WordSearchPuzzle }>('/word-search/custom', {
        method: 'POST',
        body: JSON.stringify({ title, variant, words }),
    });
    return res.puzzle;
}

export async function completeWordSearch(
    shareCode: string,
    timeElapsedMs?: number
): Promise<{ status?: string; time_elapsed_ms?: number | null }> {
    return apiFetch(`/word-search/${shareCode}/complete`, {
        method: 'POST',
        body: JSON.stringify({
            time_elapsed_ms: timeElapsedMs ?? null,
        }),
    });
}

export async function fetchSharedWordSearch(shareCode: string): Promise<WordSearchPuzzle> {
    const res = await apiFetch<{ puzzle: WordSearchPuzzle }>(`/puzzles/share/${shareCode}`);
    return res.puzzle;
}

export async function fetchCurrentFoxHunt(): Promise<FoxHuntStateResponse> {
    return apiFetch('/fox-hunt/current');
}

export async function submitFoxHuntGuess(
    shareCode: string,
    words: string[]
): Promise<FoxHuntStateResponse> {
    return apiFetch(`/fox-hunt/${shareCode}/guess`, {
        method: 'POST',
        body: JSON.stringify({ words }),
    });
}

export async function fetchFoxHuntArchive(): Promise<FoxHuntArchiveItem[]> {
    const res = await apiFetch<{ puzzles: FoxHuntArchiveItem[] }>('/fox-hunt/archive');
    return res.puzzles;
}

export async function fetchArchivedFoxHunt(shareCode: string): Promise<FoxHuntStateResponse> {
    return apiFetch(`/fox-hunt/archive/${shareCode}`);
}

export async function fastForwardFoxHunt(shareCode: string): Promise<FoxHuntStateResponse> {
    return apiFetch(`/fox-hunt/archive/${shareCode}/fast-forward`, {
        method: 'POST',
    });
}