import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    PanResponder,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import {
    ArrowLeft,
    Check,
    Eye,
    HelpCircle,
    Lightbulb,
    Lock,
    Plus,
    RotateCcw,
    Share2,
    Shuffle,
} from 'lucide-react-native';
import { createCustomWordSearch, generateWordSearch } from '../lib/api';
import {
    formatSeconds,
    generateWordSearchBoard,
    getLineCells,
} from '../lib/wordSearchGenerator';
import type { WordSearchBoard } from '../lib/wordSearchGenerator';
import type {
    WordCategory,
    WordSearchMode,
    WordSearchPuzzle,
} from '../types/wordfox';

interface WordSearchScreenProps {
    initialPuzzle: WordSearchPuzzle;
    categories: WordCategory[];
    userUnlocks: string[];
    onBackToDen: () => void;
    onPuzzleCleared: (shareCode: string, elapsedSeconds: number) => void;
}

const MYSTERY_REVEAL_MS = 3200;
const SHARE_BASE_URL = 'https://wordfox.net';

function cellKey(row: number, col: number): string {
    return `${row}-${col}`;
}

function formatModeLabel(mode: WordSearchMode): string {
    if (mode === 'scrambler') return 'The Scrambler';
    if (mode === 'mystery') return 'The Mystery';
    return 'Standard';
}

export function WordSearchScreen({
    initialPuzzle,
    categories,
    userUnlocks,
    onBackToDen,
    onPuzzleCleared,
}: WordSearchScreenProps) {
    const { width: screenWidth } = useWindowDimensions();
    const gridSizePx = Math.min(screenWidth - 40, 380);
    const cellSizePx = gridSizePx / 10;

    const [puzzle, setPuzzle] = useState<WordSearchPuzzle>(initialPuzzle);
    const [showRules, setShowRules] = useState(false);
    const [showBuilder, setShowBuilder] = useState(false);

    // Builder state
    const [builderMode, setBuilderMode] = useState<WordSearchMode>('standard');
    const [builderCategory, setBuilderCategory] = useState<string>('random');
    const [builderLoading, setBuilderLoading] = useState(false);
    const [builderError, setBuilderError] = useState<string | null>(null);

    // Friend custom words state
    const [customTitle, setCustomTitle] = useState('');
    const [customMode, setCustomMode] = useState<WordSearchMode>('standard');
    const [customWordsText, setCustomWordsText] = useState('');
    const hasFriendUnlock = userUnlocks.includes('friend');

    // Gameplay state
    const [scrambleCount, setScrambleCount] = useState(0);
    const [board, setBoard] = useState<WordSearchBoard>(() =>
        generateWordSearchBoard(initialPuzzle.words, `${initialPuzzle.seed}:0`, 10)
    );

    const [foundWords, setFoundWords] = useState<string[]>(() =>
        initialPuzzle.completed ? [...initialPuzzle.words] : []
    );
    const [foundCellKeys, setFoundCellKeys] = useState<Set<string>>(() => {
        if (!initialPuzzle.completed) return new Set();
        const initialBoard = generateWordSearchBoard(
            initialPuzzle.words,
            `${initialPuzzle.seed}:0`,
            10
        );
        const keys = new Set<string>();
        initialBoard.placements.forEach((p) => {
            p.cells.forEach((c) => keys.add(cellKey(c.row, c.col)));
        });
        return keys;
    });
    const [hintCellKeys, setHintCellKeys] = useState<Set<string>>(() => new Set());
    const [elapsedSeconds, setElapsedSeconds] = useState(() =>
        initialPuzzle.completed && initialPuzzle.completed_time_ms
            ? Math.max(1, Math.round(initialPuzzle.completed_time_ms / 1000))
            : 0
    );
    const [scrambleCountdown, setScrambleCountdown] = useState(
        initialPuzzle.scramble_interval_seconds || 30
    );

    // Mystery mode state
    const [mysteryPeeks, setMysteryPeeks] = useState<Record<string, number>>({});
    const [mysteryTouchTool, setMysteryTouchTool] = useState<'select' | 'flashlight'>('select');
    const [nowMs, setNowMs] = useState(() => Date.now());

    // Selection state
    const [dragStart, setDragStart] = useState<{ row: number; col: number } | null>(null);
    const [dragEnd, setDragEnd] = useState<{ row: number; col: number } | null>(null);
    const [tapAnchor, setTapAnchor] = useState<{ row: number; col: number } | null>(null);
    const [statusMessage, setStatusMessage] = useState(() =>
        initialPuzzle.completed
            ? 'Puzzle solved! Replay anytime or share this board.'
            : 'Swipe across letters or tap start and end tiles.'
    );
    const [recordedWin, setRecordedWin] = useState(() => Boolean(initialPuzzle.completed));

    const isComplete =
        puzzle.words.length > 0 && foundWords.length === puzzle.words.length;

    const remainingWords = useMemo(
        () =>
            puzzle.words
                .filter((w) => !foundWords.includes(w))
                .sort((a, b) => a.localeCompare(b)),
        [puzzle.words, foundWords]
    );

    const solvedWords = useMemo(
        () =>
            puzzle.words
                .filter((w) => foundWords.includes(w))
                .sort((a, b) => a.localeCompare(b)),
        [puzzle.words, foundWords]
    );

    const loadPuzzleIntoBoard = useCallback(
        (nextPuzzle: WordSearchPuzzle, forceReset = false) => {
            const alreadySolved = !forceReset && Boolean(nextPuzzle.completed);
            const nextBoard = generateWordSearchBoard(
                nextPuzzle.words,
                `${nextPuzzle.seed}:0`,
                10
            );
            const nextFoundKeys = new Set<string>();
            if (alreadySolved) {
                nextBoard.placements.forEach((p) => {
                    p.cells.forEach((c) => nextFoundKeys.add(cellKey(c.row, c.col)));
                });
            }

            setPuzzle(nextPuzzle);
            setScrambleCount(0);
            setBoard(nextBoard);
            setFoundWords(alreadySolved ? [...nextPuzzle.words] : []);
            setFoundCellKeys(nextFoundKeys);
            setHintCellKeys(new Set());
            setElapsedSeconds(
                alreadySolved && nextPuzzle.completed_time_ms
                    ? Math.max(1, Math.round(nextPuzzle.completed_time_ms / 1000))
                    : 0
            );
            setScrambleCountdown(nextPuzzle.scramble_interval_seconds || 30);
            setMysteryPeeks({});
            setDragStart(null);
            setDragEnd(null);
            setTapAnchor(null);
            setRecordedWin(alreadySolved);
            setShowBuilder(false);
            setBuilderError(null);

            if (alreadySolved) {
                setStatusMessage('Puzzle solved! Replay anytime or share this board.');
            } else if (nextPuzzle.variant === 'scrambler') {
                setStatusMessage('Letters scramble into a fresh board on the countdown.');
            } else if (nextPuzzle.variant === 'mystery') {
                setStatusMessage('Touch or sweep across tiles to peek before they fade.');
            } else {
                setStatusMessage('Swipe across letters or tap start and end tiles.');
            }
        },
        []
    );

    useEffect(() => {
        if (isComplete) return;
        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [isComplete]);

    const triggerScramble = useCallback(() => {
        const nextCount = scrambleCount + 1;
        const nextBoard = generateWordSearchBoard(
            puzzle.words,
            `${puzzle.seed}:scramble:${nextCount}`,
            10
        );

        const nextFoundCellKeys = new Set<string>();
        nextBoard.placements.forEach((placement) => {
            if (foundWords.includes(placement.word)) {
                placement.cells.forEach((cell) => {
                    nextFoundCellKeys.add(cellKey(cell.row, cell.col));
                });
            }
        });

        setBoard(nextBoard);
        setFoundCellKeys(nextFoundCellKeys);
        setHintCellKeys(new Set());
        setDragStart(null);
        setDragEnd(null);
        setTapAnchor(null);
        setScrambleCount(nextCount);
        setScrambleCountdown(puzzle.scramble_interval_seconds || 30);
        setStatusMessage(
            `Scrambled! ${foundWords.length} matched ${
                foundWords.length === 1 ? 'word' : 'words'
            } highlighted.`
        );
    }, [foundWords, puzzle.seed, puzzle.scramble_interval_seconds, puzzle.words, scrambleCount]);

    useEffect(() => {
        if (puzzle.variant !== 'scrambler' || isComplete) return;
        const timer = setInterval(() => {
            setScrambleCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [puzzle.variant, isComplete]);

    useEffect(() => {
        if (puzzle.variant === 'scrambler' && scrambleCountdown === 0 && !isComplete) {
            triggerScramble();
        }
    }, [puzzle.variant, scrambleCountdown, isComplete, triggerScramble]);

    const hasActivePeeks = useMemo(() => Object.keys(mysteryPeeks).length > 0, [mysteryPeeks]);

    useEffect(() => {
        if (puzzle.variant !== 'mystery' || !hasActivePeeks) return;
        const interval = setInterval(() => {
            const current = Date.now();
            setNowMs(current);
            setMysteryPeeks((prev) => {
                let changed = false;
                const next: Record<string, number> = {};
                for (const [k, exp] of Object.entries(prev)) {
                    if (exp > current) {
                        next[k] = exp;
                    } else {
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, 150);
        return () => clearInterval(interval);
    }, [puzzle.variant, hasActivePeeks]);

    useEffect(() => {
        if (isComplete && !recordedWin) {
            setRecordedWin(true);
            onPuzzleCleared(puzzle.share_code, elapsedSeconds);
        }
    }, [isComplete, recordedWin, puzzle.share_code, elapsedSeconds, onPuzzleCleared]);

    const revealMysteryTile = useCallback(
        (row: number, col: number) => {
            if (puzzle.variant !== 'mystery' || isComplete) return;
            const key = cellKey(row, col);
            const expiresAt = Date.now() + MYSTERY_REVEAL_MS;
            setNowMs(Date.now());
            setMysteryPeeks((prev) => {
                if (prev[key] && prev[key] > expiresAt - 400) return prev;
                return { ...prev, [key]: expiresAt };
            });
        },
        [puzzle.variant, isComplete]
    );

    const evaluateSelection = useCallback(
        (cells: Array<{ row: number; col: number }>) => {
            if (cells.length < 2) return false;
            const forward = cells.map((c) => board.grid[c.row]?.[c.col] ?? '').join('');
            const backward = [...forward].reverse().join('');

            const remaining = puzzle.words.filter((w) => !foundWords.includes(w));
            const matched = remaining.find((w) => w === forward || w === backward);

            if (matched) {
                setFoundWords((prev) => [...prev, matched]);
                setFoundCellKeys((prev) => {
                    const next = new Set(prev);
                    cells.forEach((c) => next.add(cellKey(c.row, c.col)));
                    return next;
                });
                setStatusMessage(`Found "${matched}"!`);
                return true;
            }

            setStatusMessage(`"${forward}" is not on the remaining list.`);
            return false;
        },
        [board.grid, foundWords, puzzle.words]
    );

    const getCoordsFromLocation = (x: number, y: number) => {
        const col = Math.max(0, Math.min(9, Math.floor(x / cellSizePx)));
        const row = Math.max(0, Math.min(9, Math.floor(y / cellSizePx)));
        return { row, col };
    };

    const gestureRef = useRef({
        onGrant: (_x: number, _y: number) => {},
        onMove: (_x: number, _y: number) => {},
        onRelease: () => {},
    });

    gestureRef.current = {
        onGrant: (x: number, y: number) => {
            if (isComplete) return;
            const pos = getCoordsFromLocation(x, y);
            if (puzzle.variant === 'mystery') {
                revealMysteryTile(pos.row, pos.col);
                if (mysteryTouchTool === 'flashlight') {
                    return;
                }
            }
            setDragStart(pos);
            setDragEnd(pos);
        },
        onMove: (x: number, y: number) => {
            if (isComplete) return;
            const pos = getCoordsFromLocation(x, y);
            if (puzzle.variant === 'mystery') {
                revealMysteryTile(pos.row, pos.col);
                if (mysteryTouchTool === 'flashlight') {
                    return;
                }
            }
            if (dragStart) {
                setDragEnd(pos);
            }
        },
        onRelease: () => {
            if (isComplete || !dragStart || !dragEnd) {
                setDragStart(null);
                setDragEnd(null);
                return;
            }

            if (dragStart.row === dragEnd.row && dragStart.col === dragEnd.col) {
                if (!tapAnchor) {
                    setTapAnchor(dragStart);
                } else if (tapAnchor.row === dragStart.row && tapAnchor.col === dragStart.col) {
                    setTapAnchor(null);
                } else {
                    evaluateSelection(getLineCells(tapAnchor, dragStart, board.size));
                    setTapAnchor(null);
                }
            } else {
                const line = getLineCells(dragStart, dragEnd, board.size);
                if (line.length >= 2) {
                    evaluateSelection(line);
                    setTapAnchor(null);
                }
            }

            setDragStart(null);
            setDragEnd(null);
        },
    };

    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onMoveShouldSetPanResponder: () => true,
                onPanResponderGrant: (evt) => {
                    gestureRef.current.onGrant(
                        evt.nativeEvent.locationX,
                        evt.nativeEvent.locationY
                    );
                },
                onPanResponderMove: (evt) => {
                    gestureRef.current.onMove(
                        evt.nativeEvent.locationX,
                        evt.nativeEvent.locationY
                    );
                },
                onPanResponderRelease: () => {
                    gestureRef.current.onRelease();
                },
                onPanResponderTerminate: () => {
                    gestureRef.current.onRelease();
                },
            }),
        []
    );

    const activeCells = useMemo(() => {
        if (dragStart && dragEnd) return getLineCells(dragStart, dragEnd, board.size);
        if (tapAnchor) return [tapAnchor];
        return [];
    }, [dragStart, dragEnd, tapAnchor, board.size]);

    const activeCellSet = useMemo(() => {
        const s = new Set<string>();
        activeCells.forEach((c) => s.add(cellKey(c.row, c.col)));
        return s;
    }, [activeCells]);

    const handleHint = () => {
        if (isComplete) return;
        const nextPlacement = board.placements.find((p) => !foundWords.includes(p.word));
        if (!nextPlacement) return;
        const firstCell = nextPlacement.cells[0];
        setHintCellKeys((prev) => new Set(prev).add(cellKey(firstCell.row, firstCell.col)));
        if (puzzle.variant === 'mystery') {
            revealMysteryTile(firstCell.row, firstCell.col);
        }
        setStatusMessage(
            `Hint: "${nextPlacement.word}" starts at row ${firstCell.row + 1}, col ${firstCell.col + 1}.`
        );
    };

    const handleSharePuzzle = async () => {
        const shareUrl = `${SHARE_BASE_URL}/p/${puzzle.share_code}`;
        await Share.share({
            message: `Play Word Fox (${puzzle.title} — ${formatModeLabel(puzzle.variant)}): ${shareUrl}`,
        });
    };

    const handleGenerateOnDemand = async () => {
        setBuilderLoading(true);
        setBuilderError(null);
        try {
            const generated = await generateWordSearch(builderMode, builderCategory);
            loadPuzzleIntoBoard(generated);
        } catch (err) {
            setBuilderError(err instanceof Error ? err.message : 'Could not generate puzzle.');
        } finally {
            setBuilderLoading(false);
        }
    };

    const handleCreateFriendCustom = async () => {
        setBuilderLoading(true);
        setBuilderError(null);
        try {
            const words = customWordsText
                .split(/[\n,\s]+/)
                .map((w) => w.trim())
                .filter(Boolean);
            const created = await createCustomWordSearch(customTitle, customMode, words);
            loadPuzzleIntoBoard(created);
        } catch (err) {
            setBuilderError(err instanceof Error ? err.message : 'Could not create custom puzzle.');
        } finally {
            setBuilderLoading(false);
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {/* Sub-header */}
            <View style={styles.topRow}>
                <Pressable onPress={onBackToDen} style={styles.backBtn}>
                    <ArrowLeft size={16} color="#111111" />
                    <Text style={styles.backText}>Back to Den</Text>
                </Pressable>

                <View style={styles.topActions}>
                    <Pressable
                        onPress={() => setShowBuilder((v) => !v)}
                        style={styles.orangeChip}
                    >
                        <Plus size={14} color="#FFFFFF" />
                        <Text style={styles.orangeChipText}>Custom</Text>
                    </Pressable>
                    <Pressable onPress={handleSharePuzzle} style={styles.outlineChip}>
                        <Share2 size={14} color="#111111" />
                        <Text style={styles.outlineChipText}>Share</Text>
                    </Pressable>
                    <Pressable
                        onPress={() => setShowRules((v) => !v)}
                        style={styles.outlineChip}
                    >
                        <HelpCircle size={14} color="#111111" />
                        <Text style={styles.outlineChipText}>Rules</Text>
                    </Pressable>
                </View>
            </View>

            {showRules && (
                <View style={styles.card}>
                    <Text style={styles.cardHeading}>Word Search Rules</Text>
                    <Text style={styles.bodyText}>
                        Swipe across letters (or tap start and end tiles) horizontally, vertically, or
                        diagonally.
                    </Text>
                    <Text style={styles.bodyText}>
                        Standard: Classic grid. The Scrambler: Rearranges the board every 30s while keeping
                        matched words highlighted. The Mystery: Touch or sweep to peek letters for 3 seconds
                        before they fade.
                    </Text>
                </View>
            )}

            {showBuilder && (
                <View style={styles.card}>
                    <Text style={styles.cardHeading}>Build Anytime Puzzle (Free)</Text>
                    <Text style={styles.mutedText}>Category</Text>
                    <View style={styles.chipWrap}>
                        <Pressable
                            onPress={() => setBuilderCategory('random')}
                            style={[
                                styles.selectChip,
                                builderCategory === 'random' && styles.selectChipActive,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.selectChipText,
                                    builderCategory === 'random' && styles.selectChipTextActive,
                                ]}
                            >
                                Surprise Mix
                            </Text>
                        </Pressable>
                        {categories.map((cat) => (
                            <Pressable
                                key={cat.slug}
                                onPress={() => setBuilderCategory(cat.slug)}
                                style={[
                                    styles.selectChip,
                                    builderCategory === cat.slug && styles.selectChipActive,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.selectChipText,
                                        builderCategory === cat.slug && styles.selectChipTextActive,
                                    ]}
                                >
                                    {cat.name}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    <Text style={styles.mutedText}>Puzzle Type</Text>
                    <View style={styles.chipWrap}>
                        {(['standard', 'scrambler', 'mystery'] as const).map((m) => (
                            <Pressable
                                key={m}
                                onPress={() => setBuilderMode(m)}
                                style={[
                                    styles.selectChip,
                                    builderMode === m && styles.selectChipActive,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.selectChipText,
                                        builderMode === m && styles.selectChipTextActive,
                                    ]}
                                >
                                    {formatModeLabel(m)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    <Pressable
                        onPress={handleGenerateOnDemand}
                        disabled={builderLoading}
                        style={styles.primaryBtn}
                    >
                        <Text style={styles.primaryBtnText}>
                            {builderLoading ? 'Generating...' : 'Generate Puzzle'}
                        </Text>
                    </Pressable>

                    <View style={styles.divider} />

                    <View style={styles.rowBetween}>
                        <Text style={styles.cardHeading}>Custom Word List (Friend)</Text>
                        {!hasFriendUnlock && <Lock size={15} color="#FF5A1F" />}
                    </View>
                    {hasFriendUnlock ? (
                        <View style={{ gap: 8 }}>
                            <TextInput
                                value={customTitle}
                                onChangeText={setCustomTitle}
                                placeholder="Puzzle Title"
                                style={styles.input}
                            />
                            <View style={styles.chipWrap}>
                                {(['standard', 'scrambler', 'mystery'] as const).map((m) => (
                                    <Pressable
                                        key={m}
                                        onPress={() => setCustomMode(m)}
                                        style={[
                                            styles.selectChip,
                                            customMode === m && styles.selectChipActive,
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.selectChipText,
                                                customMode === m && styles.selectChipTextActive,
                                            ]}
                                        >
                                            {formatModeLabel(m)}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                            <TextInput
                                value={customWordsText}
                                onChangeText={setCustomWordsText}
                                placeholder="4 to 10 words separated by spaces or commas"
                                multiline
                                style={[styles.input, { minHeight: 64 }]}
                            />
                            <Pressable
                                onPress={handleCreateFriendCustom}
                                disabled={builderLoading}
                                style={[styles.primaryBtn, { backgroundColor: '#FF5A1F' }]}
                            >
                                <Text style={styles.primaryBtnText}>Create Custom Puzzle</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <Text style={styles.mutedText}>
                            Sign in with a Friend unlock to enter custom words. Anyone can still play links
                            shared with them.
                        </Text>
                    )}

                    {builderError && <Text style={styles.errorText}>{builderError}</Text>}
                </View>
            )}

            {/* Main Board Card */}
            <View style={styles.card}>
                <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.mutedText}>
                            {puzzle.source === 'official' ? 'Official Daily' : 'Custom'} ·{' '}
                            {foundWords.length}/{puzzle.words.length} found
                        </Text>
                        <Text style={styles.titleText}>
                            {puzzle.title} ({formatModeLabel(puzzle.variant)})
                        </Text>
                    </View>
                    <View style={styles.timersRow}>
                        {puzzle.variant === 'scrambler' && (
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text style={styles.mutedText}>Scramble</Text>
                                <Text style={[styles.timerVal, { color: '#FF5A1F' }]}>
                                    {formatSeconds(scrambleCountdown)}
                                </Text>
                            </View>
                        )}
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text style={styles.mutedText}>Time</Text>
                            <Text style={styles.timerVal}>{formatSeconds(elapsedSeconds)}</Text>
                        </View>
                    </View>
                </View>

                {puzzle.variant === 'scrambler' && !isComplete && (
                    <Pressable onPress={triggerScramble} style={styles.inlineLink}>
                        <Shuffle size={14} color="#FF5A1F" />
                        <Text style={{ color: '#FF5A1F', fontWeight: '700', fontSize: 12 }}>
                            Scramble Now
                        </Text>
                    </Pressable>
                )}

                {puzzle.variant === 'mystery' && !isComplete && (
                    <View style={styles.chipWrap}>
                        <Pressable
                            onPress={() => setMysteryTouchTool('select')}
                            style={[
                                styles.selectChip,
                                mysteryTouchTool === 'select' && styles.selectChipActive,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.selectChipText,
                                    mysteryTouchTool === 'select' && styles.selectChipTextActive,
                                ]}
                            >
                                Select Word
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => setMysteryTouchTool('flashlight')}
                            style={[
                                styles.selectChip,
                                mysteryTouchTool === 'flashlight' && {
                                    backgroundColor: '#FF5A1F',
                                    borderColor: '#FF5A1F',
                                },
                            ]}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Eye
                                    size={13}
                                    color={mysteryTouchTool === 'flashlight' ? '#FFFFFF' : '#111111'}
                                />
                                <Text
                                    style={[
                                        styles.selectChipText,
                                        mysteryTouchTool === 'flashlight' &&
                                            styles.selectChipTextActive,
                                    ]}
                                >
                                    Touch Peek
                                </Text>
                            </View>
                        </Pressable>
                    </View>
                )}

                {isComplete ? (
                    <View style={styles.victoryBox}>
                        <Text style={styles.titleText}>Sly Work! Puzzle Cleared</Text>
                        <Text style={styles.bodyText}>
                            All {puzzle.words.length} words solved in {formatSeconds(elapsedSeconds)}.
                        </Text>
                        <View style={styles.topActions}>
                            <Pressable
                                onPress={handleSharePuzzle}
                                style={[styles.primaryBtn, { backgroundColor: '#FF5A1F' }]}
                            >
                                <Text style={styles.primaryBtnText}>Share Result</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => loadPuzzleIntoBoard(puzzle, true)}
                                style={styles.primaryBtn}
                            >
                                <Text style={styles.primaryBtnText}>Replay</Text>
                            </Pressable>
                        </View>
                    </View>
                ) : (
                    <View
                        pointerEvents="box-only"
                        {...panResponder.panHandlers}
                        style={[styles.gridBox, { width: gridSizePx, height: gridSizePx }]}
                    >
                        {board.grid.map((rowArr, rIdx) => (
                            <View key={rIdx} style={{ flexDirection: 'row' }}>
                                {rowArr.map((letter, cIdx) => {
                                    const key = cellKey(rIdx, cIdx);
                                    const isFound = foundCellKeys.has(key);
                                    const isActive = activeCellSet.has(key);
                                    const isHinted = hintCellKeys.has(key);
                                    const peekExpiry = mysteryPeeks[key];
                                    const isPeeked =
                                        puzzle.variant === 'mystery' &&
                                        Boolean(peekExpiry && peekExpiry > nowMs);
                                    const showLetter =
                                        puzzle.variant !== 'mystery' ||
                                        isFound ||
                                        isPeeked ||
                                        isActive ||
                                        isHinted;

                                    let bg = '#FAFAFA';
                                    let border = '#E4E4E7';
                                    let textColor = '#111111';

                                    if (isActive) {
                                        bg = '#111111';
                                        border = '#111111';
                                        textColor = '#FFFFFF';
                                    } else if (isFound) {
                                        bg = '#FF5A1F';
                                        border = '#FF5A1F';
                                        textColor = '#FFFFFF';
                                    } else if (puzzle.variant === 'mystery' && !showLetter) {
                                        bg = '#111111';
                                        border = '#111111';
                                        textColor = 'transparent';
                                    } else if (puzzle.variant === 'mystery' && isPeeked) {
                                        bg = '#FFFFFF';
                                        border = '#FF5A1F';
                                    } else if (isHinted) {
                                        bg = '#FFE8DF';
                                        border = '#FF5A1F';
                                    }

                                    return (
                                        <View
                                            key={key}
                                            style={{
                                                width: cellSizePx,
                                                height: cellSizePx,
                                                padding: 2,
                                            }}
                                        >
                                            <View
                                                style={[
                                                    styles.tile,
                                                    { backgroundColor: bg, borderColor: border },
                                                ]}
                                            >
                                                <Text style={[styles.tileLetter, { color: textColor }]}>
                                                    {showLetter ? letter : ''}
                                                </Text>
                                            </View>
                                        </View>
                                    );
                                })}
                            </View>
                        ))}
                    </View>
                )}

                <Text style={styles.mutedText}>{statusMessage}</Text>

                <View style={styles.rowBetween}>
                    <Pressable onPress={handleHint} disabled={isComplete} style={styles.outlineChip}>
                        <Lightbulb size={14} color="#FF5A1F" />
                        <Text style={styles.outlineChipText}>Hint</Text>
                    </Pressable>
                    <Pressable
                        onPress={() => loadPuzzleIntoBoard(puzzle, true)}
                        style={styles.outlineChip}
                    >
                        <RotateCcw size={14} color="#111111" />
                        <Text style={styles.outlineChipText}>Reset</Text>
                    </Pressable>
                </View>
            </View>

            {/* Word List */}
            <View style={styles.card}>
                <View style={styles.rowBetween}>
                    <Text style={styles.cardHeading}>Word List</Text>
                    <Text style={styles.mutedText}>
                        {foundWords.length}/{puzzle.words.length} Found
                    </Text>
                </View>

                {remainingWords.length > 0 && (
                    <View style={styles.wordGrid}>
                        {remainingWords.map((word) => (
                            <View key={word} style={styles.wordPill}>
                                <Text style={styles.wordText}>{word}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {solvedWords.length > 0 && (
                    <>
                        {remainingWords.length > 0 && (
                            <>
                                <View style={styles.divider} />
                                <Text style={styles.solvedLabel}>
                                    SOLVED ({solvedWords.length})
                                </Text>
                            </>
                        )}
                        <View style={styles.wordGrid}>
                            {solvedWords.map((word) => (
                                <View
                                    key={word}
                                    style={[styles.wordPill, styles.wordPillSolved]}
                                >
                                    <Text style={[styles.wordText, styles.wordTextSolved]}>
                                        {word}
                                    </Text>
                                    <Check size={14} color="#FF5A1F" />
                                </View>
                            ))}
                        </View>
                    </>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
        gap: 14,
        paddingBottom: 40,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
    },
    backBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
    },
    backText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111111',
    },
    topActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    orangeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#FF5A1F',
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
    },
    orangeChipText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    outlineChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
    },
    outlineChipText: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '600',
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 16,
        padding: 14,
        gap: 10,
    },
    cardHeading: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111111',
    },
    titleText: {
        fontSize: 18,
        fontWeight: '800',
        color: '#111111',
    },
    bodyText: {
        fontSize: 13,
        color: '#3F3F46',
        lineHeight: 19,
    },
    mutedText: {
        fontSize: 12,
        color: '#71717A',
    },
    errorText: {
        fontSize: 12,
        color: '#DC2626',
        fontWeight: '600',
    },
    rowBetween: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    timersRow: {
        flexDirection: 'row',
        gap: 14,
    },
    timerVal: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111111',
    },
    gridBox: {
        alignSelf: 'center',
        marginVertical: 4,
    },
    tile: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tileLetter: {
        fontSize: 15,
        fontWeight: '800',
    },
    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    selectChip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E4E4E7',
        backgroundColor: '#FAFAFA',
    },
    selectChipActive: {
        backgroundColor: '#111111',
        borderColor: '#111111',
    },
    selectChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#111111',
    },
    selectChipTextActive: {
        color: '#FFFFFF',
    },
    input: {
        borderWidth: 1,
        borderColor: '#D4D4D8',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#FAFAFA',
        fontSize: 13,
    },
    primaryBtn: {
        backgroundColor: '#111111',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    primaryBtnText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    divider: {
        height: 1,
        backgroundColor: '#E4E4E7',
        marginVertical: 4,
    },
    inlineLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    victoryBox: {
        padding: 16,
        backgroundColor: '#FAFAFA',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E4E4E7',
        alignItems: 'center',
        gap: 10,
    },
    solvedLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        color: '#71717A',
    },
    wordGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    wordPill: {
        width: '48%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E4E4E7',
        backgroundColor: '#FAFAFA',
    },
    wordPillSolved: {
        backgroundColor: '#FFF0EA',
        borderColor: '#FF5A1F',
    },
    wordText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#111111',
    },
    wordTextSolved: {
        textDecorationLine: 'line-through',
        color: '#71717A',
    },
});