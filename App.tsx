import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import {
    ActivityIndicator,
    Image,
    Platform,
    Pressable,
    RefreshControl,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { ArrowRight, Lock, LogOut } from 'lucide-react-native';
import { FoxHuntScreen } from './src/screens/FoxHuntScreen';
import { WordSearchScreen } from './src/screens/WordSearchScreen';
import {
    completeWordSearch,
    fetchCurrentFoxHunt,
    fetchDailyWordSearch,
    fetchGames,
    fetchSharedWordSearch,
    fetchStats,
    fetchUserProfile,
    logoutAccount,
    signInWithGoogle,
} from './src/lib/api';
import { formatSeconds } from './src/lib/wordSearchGenerator';
import type {
    FoxHuntStateResponse,
    GameCatalogItem,
    PlayerStatsResponse,
    UserProfile,
    WordCategory,
    WordSearchPuzzle,
} from './src/types/wordfox';

type ActiveView = 'den' | 'word-search' | 'fox-hunt';

interface LocalStats {
    wordSearchCleared: number;
    foxHuntWon: number;
    foxHuntPlayed: number;
    bestSearchSeconds: number | null;
    dailyStreak: number;
}

const STATS_KEY = 'wordfox_local_stats_v1';

const DEFAULT_STATS: LocalStats = {
    wordSearchCleared: 0,
    foxHuntWon: 0,
    foxHuntPlayed: 0,
    bestSearchSeconds: null,
    dailyStreak: 0,
};

function mapServerStats(remote: PlayerStatsResponse): LocalStats {
    return {
        wordSearchCleared: remote.word_search_cleared,
        foxHuntWon: remote.fox_hunt_won,
        foxHuntPlayed: remote.fox_hunt_played,
        bestSearchSeconds: remote.best_search_seconds,
        dailyStreak: remote.daily_streak,
    };
}

export default function App() {
    const [view, setView] = useState<ActiveView>('den');
    const [games, setGames] = useState<GameCatalogItem[]>([]);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [stats, setStats] = useState<LocalStats>(DEFAULT_STATS);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [signingIn, setSigningIn] = useState(false);
    const [openingGame, setOpeningGame] = useState<string | null>(null);
    const [shareCodeInput, setShareCodeInput] = useState('');
    const [openingShare, setOpeningShare] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [wordSearchData, setWordSearchData] = useState<{
        puzzle: WordSearchPuzzle;
        categories: WordCategory[];
    } | null>(null);
    const [foxHuntData, setFoxHuntData] = useState<FoxHuntStateResponse | null>(null);

    const persistStats = useCallback(async (next: LocalStats) => {
        try {
            await AsyncStorage.setItem(STATS_KEY, JSON.stringify(next));
        } catch {
            // Ignore local storage errors
        }
    }, []);

    const refreshStats = useCallback(async () => {
        try {
            const remote = await fetchStats();
            const mapped = mapServerStats(remote);
            setStats(mapped);
            await persistStats(mapped);
        } catch {
            // Keep cached stats if offline
        }
    }, [persistStats]);

    const loadDenData = useCallback(async () => {
        setError(null);
        try {
            const [catalog, profile, remoteStats] = await Promise.all([
                fetchGames(),
                fetchUserProfile(),
                fetchStats().catch(() => null),
            ]);
            setGames(catalog);
            setUser(profile);
            if (remoteStats) {
                const mapped = mapServerStats(remoteStats);
                setStats(mapped);
                await persistStats(mapped);
            }
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Could not reach the Word Fox API. Check EXPO_PUBLIC_API_URL and php artisan serve.'
            );
        }
    }, [persistStats]);

    useEffect(() => {
        async function boot() {
            try {
                const cachedRaw = await AsyncStorage.getItem(STATS_KEY);
                if (cachedRaw) {
                    setStats({ ...DEFAULT_STATS, ...JSON.parse(cachedRaw) });
                }
            } catch {
                // Ignore invalid cached JSON
            }

            await loadDenData();
            setLoading(false);
        }

        void boot();
    }, [loadDenData]);

    const onRefresh = async () => {
        setRefreshing(true);
        await loadDenData();
        setRefreshing(false);
    };

    const displayName = user?.display_name || 'Fox';
    const unlocks = user?.unlocks || [];

    const handleGoogleSignIn = async () => {
        if (signingIn) return;
        setError(null);
        setSigningIn(true);

        try {
            const result = await signInWithGoogle();
            if (result.ok) {
                await loadDenData();
            }
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Could not complete Google sign-in.'
            );
        } finally {
            setSigningIn(false);
        }
    };

    const openGame = async (slug: string) => {
        if (openingGame) return;
        setError(null);
        setOpeningGame(slug);

        try {
            if (slug === 'word-search') {
                const data = await fetchDailyWordSearch();
                setWordSearchData(data);
                setView('word-search');
            } else if (slug === 'fox-hunt') {
                const data = await fetchCurrentFoxHunt();
                setFoxHuntData(data);
                setView('fox-hunt');
            }
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load puzzle.'
            );
        } finally {
            setOpeningGame(null);
        }
    };

    const openSharedCode = async () => {
        const clean = shareCodeInput.trim();
        if (!clean || openingShare) return;

        setError(null);
        setOpeningShare(true);
        try {
            const [sharedPuzzle, dailyData] = await Promise.all([
                fetchSharedWordSearch(clean),
                fetchDailyWordSearch(),
            ]);

            if (
                'game_slug' in sharedPuzzle &&
                (sharedPuzzle as { game_slug?: string }).game_slug === 'fox-hunt'
            ) {
                const hunt = await fetchCurrentFoxHunt();
                setFoxHuntData(hunt);
                setView('fox-hunt');
            } else {
                setWordSearchData({
                    puzzle: sharedPuzzle,
                    categories: dailyData.categories,
                });
                setView('word-search');
            }
            setShareCodeInput('');
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Could not open share code.'
            );
        } finally {
            setOpeningShare(false);
        }
    };

    const handleBackToDen = () => {
        setView('den');
        void refreshStats();
    };

    const handlePuzzleCleared = useCallback(
        async (shareCode: string, elapsedSeconds: number) => {
            setStats((prev) => {
                const updated: LocalStats = {
                    ...prev,
                    wordSearchCleared: prev.wordSearchCleared + 1,
                    bestSearchSeconds:
                        prev.bestSearchSeconds === null
                            ? elapsedSeconds
                            : Math.min(prev.bestSearchSeconds, elapsedSeconds),
                };
                void persistStats(updated);
                return updated;
            });

            try {
                await completeWordSearch(shareCode, Math.max(100, Math.round(elapsedSeconds * 1000)));
                await refreshStats();
            } catch {
                // Keep optimistic stats if offline
            }
        },
        [persistStats, refreshStats]
    );

    const handleHuntFinished = useCallback(
        async (_shareCode: string, won: boolean) => {
            setStats((prev) => {
                const updated: LocalStats = {
                    ...prev,
                    foxHuntPlayed: prev.foxHuntPlayed + 1,
                    foxHuntWon: prev.foxHuntWon + (won ? 1 : 0),
                };
                void persistStats(updated);
                return updated;
            });

            await refreshStats();
        },
        [persistStats, refreshStats]
    );

    const handleLogout = async () => {
        await logoutAccount();
        setUser(null);
        setStats(DEFAULT_STATS);
        await persistStats(DEFAULT_STATS);
        await refreshStats();
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <ExpoStatusBar style="dark" />

            {view === 'word-search' && wordSearchData ? (
                <WordSearchScreen
                    key={wordSearchData.puzzle.share_code}
                    initialPuzzle={wordSearchData.puzzle}
                    categories={wordSearchData.categories}
                    userUnlocks={unlocks}
                    onBackToDen={handleBackToDen}
                    onPuzzleCleared={handlePuzzleCleared}
                />
            ) : view === 'fox-hunt' && foxHuntData ? (
                <FoxHuntScreen
                    initialState={foxHuntData}
                    userUnlocks={unlocks}
                    onBackToDen={handleBackToDen}
                    onHuntFinished={handleHuntFinished}
                />
            ) : (
                <ScrollView
                    style={styles.screen}
                    contentContainerStyle={styles.content}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#FF5A1F"
                        />
                    }
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.brandRow}>
                        <Image
                                source={require('./assets/logo.png')}
                                style={styles.brandLogo}
                                resizeMode="contain"
                            />
                        <Text style={styles.brand}>Word Fox</Text>

                        {user ? (
                            <Pressable onPress={handleLogout} style={styles.authButton}>
                                <Text style={styles.authButtonText}>Sign Out</Text>
                                <LogOut size={14} color="#FFFFFF" />
                            </Pressable>
                        ) : (
                            <Pressable
                                onPress={handleGoogleSignIn}
                                disabled={signingIn}
                                style={[
                                    styles.authButton,
                                    signingIn && styles.disabled,
                                ]}
                            >
                                {signingIn ? (
                                    <ActivityIndicator color="#FFFFFF" size="small" />
                                ) : (
                                    <Text style={styles.authButtonText}>
                                        Sign In with Google
                                    </Text>
                                )}
                            </Pressable>
                        )}
                    </View>

                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}

                    <View style={styles.hero}>
                        <Text style={styles.greeting}>Welcome back, {displayName}</Text>
                        <Text style={styles.heading}>The Den</Text>
                        <Text style={styles.subtext}>
                            {user
                                ? 'Your streaks and unlocks are synced to your account.'
                                : 'Playing as a guest with tracking saved to your device and synced when you sign in.'}
                        </Text>
                    </View>

                    <View style={styles.statsGrid}>
                        <View style={styles.statCard}>
                            <Text style={styles.statLabel}>Daily Streak</Text>
                            <Text style={[styles.statValue, styles.statAccent]}>
                                {stats.dailyStreak}
                            </Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statLabel}>Searches Cleared</Text>
                            <Text style={styles.statValue}>{stats.wordSearchCleared}</Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statLabel}>Best Search</Text>
                            <Text style={[styles.statValue, styles.statAccent]}>
                                {stats.bestSearchSeconds !== null
                                    ? formatSeconds(stats.bestSearchSeconds)
                                    : '--:--'}
                            </Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statLabel}>Fox Hunts Won</Text>
                            <Text style={styles.statValue}>
                                {stats.foxHuntWon}/{stats.foxHuntPlayed}
                            </Text>
                        </View>
                    </View>

                    {loading ? (
                        <View style={styles.loadingBox}>
                            <ActivityIndicator color="#FF5A1F" />
                            <Text style={styles.loadingText}>Loading games...</Text>
                        </View>
                    ) : (
                        <View style={styles.gamesList}>
                            {games.map((game) => {
                                const isLocked =
                                    Boolean(game.required_unlock) &&
                                    !unlocks.includes(game.required_unlock as string);
                                const isBusy = openingGame === game.slug;

                                return (
                                    <View key={game.id} style={styles.gameCard}>
                                        <View style={styles.gameBody}>
                                            <Text style={styles.cadence}>
                                                {game.cadence} edition
                                            </Text>
                                            <Text style={styles.gameName}>{game.name}</Text>
                                            <Text style={styles.gameTagline}>
                                                {game.tagline}
                                            </Text>
                                        </View>

                                        <View style={styles.gameFooter}>
                                            {isLocked ? (
                                                <View style={styles.lockedRow}>
                                                    <Lock size={15} color="#71717A" />
                                                    <Text style={styles.lockedText}>
                                                        Requires {game.required_unlock}
                                                    </Text>
                                                </View>
                                            ) : (
                                                <Pressable
                                                    onPress={() => openGame(game.slug)}
                                                    disabled={Boolean(openingGame)}
                                                    style={[
                                                        styles.enterButton,
                                                        Boolean(openingGame) && styles.disabled,
                                                    ]}
                                                >
                                                    {isBusy ? (
                                                        <ActivityIndicator
                                                            color="#FFFFFF"
                                                            size="small"
                                                        />
                                                    ) : (
                                                        <>
                                                            <Text style={styles.enterButtonText}>
                                                                Enter {game.name}
                                                            </Text>
                                                            <ArrowRight size={16} color="#FFFFFF" />
                                                        </>
                                                    )}
                                                </Pressable>
                                            )}
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}

                    <View style={styles.shareCard}>
                        <Text style={styles.shareTitle}>Open a Share Code</Text>
                        <View style={styles.shareRow}>
                            <TextInput
                                value={shareCodeInput}
                                onChangeText={setShareCodeInput}
                                placeholder="e.g. A1B2C3D4"
                                placeholderTextColor="#A1A1AA"
                                autoCapitalize="characters"
                                autoCorrect={false}
                                style={styles.shareInput}
                            />
                            <Pressable
                                onPress={openSharedCode}
                                disabled={!shareCodeInput.trim() || openingShare}
                                style={[
                                    styles.shareGoButton,
                                    (!shareCodeInput.trim() || openingShare) &&
                                        styles.disabled,
                                ]}
                            >
                                {openingShare ? (
                                    <ActivityIndicator color="#FFFFFF" size="small" />
                                ) : (
                                    <Text style={styles.shareGoText}>Play</Text>
                                )}
                            </Pressable>
                        </View>
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#FAFAFA',
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
    },
    screen: {
        flex: 1,
        backgroundColor: '#FAFAFA',
    },
    content: {
        padding: 16,
        paddingBottom: 40,
        gap: 18,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#E4E4E7',
    },
    brandRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    brandLogo: {
        width: 28,
        height: 28,
    },
    brand: {
        fontSize: 22,
        fontWeight: '800',
        color: '#111111',
        letterSpacing: -0.5,
    },
    authButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#111111',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
    },
    authButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    errorBox: {
        backgroundColor: '#FEF2F2',
        borderWidth: 1,
        borderColor: '#FECACA',
        borderRadius: 12,
        padding: 12,
    },
    errorText: {
        fontSize: 13,
        color: '#991B1B',
        lineHeight: 18,
    },
    hero: {
        gap: 4,
    },
    greeting: {
        fontSize: 13,
        fontWeight: '700',
        color: '#FF5A1F',
    },
    heading: {
        fontSize: 30,
        fontWeight: '800',
        color: '#111111',
        letterSpacing: -0.5,
    },
    subtext: {
        fontSize: 14,
        color: '#52525B',
        lineHeight: 20,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    statCard: {
        width: '48%',
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 14,
        padding: 14,
        gap: 4,
    },
    statLabel: {
        fontSize: 12,
        color: '#71717A',
    },
    statValue: {
        fontSize: 22,
        fontWeight: '800',
        color: '#111111',
        fontVariant: ['tabular-nums'],
    },
    statAccent: {
        color: '#FF5A1F',
    },
    loadingBox: {
        paddingVertical: 24,
        alignItems: 'center',
        gap: 8,
    },
    loadingText: {
        fontSize: 13,
        color: '#71717A',
    },
    gamesList: {
        gap: 14,
    },
    gameCard: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 16,
        padding: 18,
        gap: 16,
    },
    gameBody: {
        gap: 4,
    },
    cadence: {
        fontSize: 12,
        color: '#71717A',
        textTransform: 'capitalize',
    },
    gameName: {
        fontSize: 22,
        fontWeight: '800',
        color: '#111111',
    },
    gameTagline: {
        fontSize: 14,
        color: '#52525B',
        lineHeight: 20,
    },
    gameFooter: {
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#E4E4E7',
        alignItems: 'flex-end',
    },
    lockedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    lockedText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#71717A',
    },
    enterButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#111111',
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 12,
    },
    enterButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    shareCard: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    shareTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#111111',
    },
    shareRow: {
        flexDirection: 'row',
        gap: 10,
    },
    shareInput: {
        flex: 1,
        backgroundColor: '#FAFAFA',
        borderWidth: 1,
        borderColor: '#D4D4D8',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        fontWeight: '600',
        color: '#111111',
    },
    shareGoButton: {
        backgroundColor: '#FF5A1F',
        borderRadius: 10,
        paddingHorizontal: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    shareGoText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    disabled: {
        opacity: 0.45,
    },
});