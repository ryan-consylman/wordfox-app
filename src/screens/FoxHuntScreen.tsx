import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import {
    ArrowLeft,
    BookOpen,
    Calendar,
    Check,
    FastForward,
    HelpCircle,
    Lock,
    Share2,
    X,
} from 'lucide-react-native';
import {
    fastForwardFoxHunt,
    fetchArchivedFoxHunt,
    fetchCurrentFoxHunt,
    fetchFoxHuntArchive,
    submitFoxHuntGuess,
} from '../lib/api';
import type {
    ApiValidationError,
    FoxHuntArchiveItem,
    FoxHuntStateResponse,
} from '../types/wordfox';

interface FoxHuntScreenProps {
    initialState: FoxHuntStateResponse;
    userUnlocks: string[];
    onBackToDen: () => void;
    onHuntFinished: (shareCode: string, won: boolean) => void;
}

export function FoxHuntScreen({
    initialState,
    userUnlocks,
    onBackToDen,
    onHuntFinished,
}: FoxHuntScreenProps) {
    const [huntState, setHuntState] = useState<FoxHuntStateResponse>(initialState);
    const [draftWords, setDraftWords] = useState<string[]>(() =>
        initialState.progress.slots.map((slot) => slot.word ?? '')
    );
    const [invalidSlotMap, setInvalidSlotMap] = useState<Record<number, string>>({});
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [fastForwarding, setFastForwarding] = useState(false);

    const [rulesOpen, setRulesOpen] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [archiveLoading, setArchiveLoading] = useState(false);
    const [archiveItems, setArchiveItems] = useState<FoxHuntArchiveItem[]>([]);

    const isFriend = userUnlocks.includes('friend');

    useEffect(() => {
        setHuntState(initialState);
        setDraftWords(initialState.progress.slots.map((slot) => slot.word ?? ''));
        setInvalidSlotMap({});
        setErrorMessage(null);
    }, [initialState]);

    const applyNewState = (next: FoxHuntStateResponse) => {
        const previousStatus = huntState.progress.status;
        setHuntState(next);
        setDraftWords(next.progress.slots.map((slot) => slot.word ?? ''));
        setInvalidSlotMap({});
        setErrorMessage(null);

        if (
            previousStatus === 'in_progress' &&
            (next.progress.status === 'won' || next.progress.status === 'lost')
        ) {
            onHuntFinished(
                next.puzzle.share_code,
                next.progress.status === 'won'
            );
        }
    };

    const { puzzle, progress } = huntState;
    const isFinished = progress.status === 'won' || progress.status === 'lost';
    const canSubmit =
        !isFinished && !progress.today_guess_used && !submitting && !fastForwarding;
    const canFastForward =
        isFriend &&
        !puzzle.is_current_week &&
        puzzle.can_fast_forward &&
        !isFinished;

    const allSlotsFilled = useMemo(
        () =>
            progress.slots.every((slot, idx) => {
                const value =
                    slot.locked_by !== null
                        ? slot.word ?? ''
                        : draftWords[idx] ?? '';
                return value.trim().length > 0;
            }),
        [draftWords, progress.slots]
    );

    const handleWordChange = (index: number, value: string) => {
        setDraftWords((prev) => {
            const copy = [...prev];
            copy[index] = value.replace(/\s+/g, '');
            return copy;
        });

        if (invalidSlotMap[index]) {
            setInvalidSlotMap((prev) => {
                const next = { ...prev };
                delete next[index];
                return next;
            });
        }

        if (errorMessage) {
            setErrorMessage(null);
        }
    };

    const handleSubmitGuess = async () => {
        if (!canSubmit) return;

        const payloadWords = progress.slots.map((slot, idx) =>
            (slot.locked_by !== null ? slot.word ?? '' : draftWords[idx] ?? '')
                .trim()
                .toLowerCase()
        );

        if (payloadWords.some((w) => w.length === 0)) {
            setErrorMessage('Fill in all 10 word slots before submitting.');
            return;
        }

        setSubmitting(true);
        setErrorMessage(null);

        try {
            const next = await submitFoxHuntGuess(puzzle.share_code, payloadWords);
            applyNewState(next);
        } catch (err) {
            const apiErr = err as ApiValidationError;
            if (apiErr.invalidSlots && apiErr.invalidSlots.length > 0) {
                const map: Record<number, string> = {};
                const details = apiErr.invalidSlots.map((item) => {
                    map[item.index] = item.word;
                    return `"${item.word}" (Word ${item.index + 1})`;
                });
                setInvalidSlotMap(map);
                setErrorMessage(
                    `Invalid word(s): ${details.join(', ')}. Fix them and try again — your daily guess was not used.`
                );
            } else {
                setErrorMessage(apiErr.message || 'Could not submit guess.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleFastForward = async () => {
        if (!canFastForward || fastForwarding) return;

        setFastForwarding(true);
        setErrorMessage(null);
        try {
            const next = await fastForwardFoxHunt(puzzle.share_code);
            applyNewState(next);
        } catch (err) {
            setErrorMessage(
                err instanceof Error ? err.message : 'Could not fast forward.'
            );
        } finally {
            setFastForwarding(false);
        }
    };

    const openArchiveModal = async () => {
        setArchiveOpen(true);
        if (!isFriend) return;

        setArchiveLoading(true);
        try {
            const items = await fetchFoxHuntArchive();
            setArchiveItems(items);
        } catch (err) {
            setErrorMessage(
                err instanceof Error ? err.message : 'Failed to load archive.'
            );
        } finally {
            setArchiveLoading(false);
        }
    };

    const loadArchivedHunt = async (shareCode: string) => {
        setArchiveOpen(false);
        setErrorMessage(null);
        try {
            const next = await fetchArchivedFoxHunt(shareCode);
            setHuntState(next);
            setDraftWords(next.progress.slots.map((slot) => slot.word ?? ''));
            setInvalidSlotMap({});
        } catch (err) {
            setErrorMessage(
                err instanceof Error ? err.message : 'Could not open archived hunt.'
            );
        }
    };

    const loadCurrentHunt = async () => {
        setErrorMessage(null);
        try {
            const next = await fetchCurrentFoxHunt();
            setHuntState(next);
            setDraftWords(next.progress.slots.map((slot) => slot.word ?? ''));
            setInvalidSlotMap({});
        } catch (err) {
            setErrorMessage(
                err instanceof Error ? err.message : 'Could not load active Fox Hunt.'
            );
        }
    };

    const handleShare = async () => {
        const lockedCount = progress.slots.filter((s) => s.locked_by !== null).length;
        const summary =
            progress.status === 'won'
                ? `I solved ${puzzle.title} on Day ${progress.day_index}/7 in Word Fox!`
                : `Playing ${puzzle.title} in Word Fox (${lockedCount}/10 words locked on Day ${progress.day_index}/7).`;

        try {
            await Share.share({
                message: `${summary}\nhttps://wordfox.net/p/${puzzle.share_code}`,
            });
        } catch {
            // User dismissed share sheet
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                style={styles.screen}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.topBar}>
                    <Pressable onPress={onBackToDen} style={styles.backButton}>
                        <ArrowLeft size={18} color="#111111" />
                        <Text style={styles.backButtonText}>The Den</Text>
                    </Pressable>

                    <View style={styles.topActions}>
                        <Pressable
                            onPress={openArchiveModal}
                            style={styles.iconButton}
                        >
                            <Calendar size={16} color="#111111" />
                            <Text style={styles.iconButtonText}>Archive</Text>
                        </Pressable>

                        <Pressable
                            onPress={() => setRulesOpen(true)}
                            style={styles.iconButton}
                        >
                            <HelpCircle size={16} color="#111111" />
                            <Text style={styles.iconButtonText}>Rules</Text>
                        </Pressable>

                        <Pressable onPress={handleShare} style={styles.iconButton}>
                            <Share2 size={16} color="#111111" />
                        </Pressable>
                    </View>
                </View>

                <View style={styles.headerCard}>
                    <View style={styles.headerMetaRow}>
                        <Text style={styles.eyebrow}>
                            {puzzle.is_current_week ? 'Active Weekly Hunt' : 'Archived Hunt'}
                        </Text>
                        <Text style={styles.dayBadge}>
                            Day {progress.day_index} of 7
                        </Text>
                    </View>

                    <Text style={styles.title}>{puzzle.title}</Text>

                    {puzzle.theme_hint && (
                        <Text style={styles.hint}>Theme: {puzzle.theme_hint}</Text>
                    )}

                    {!puzzle.is_current_week && (
                        <Pressable
                            onPress={loadCurrentHunt}
                            style={styles.returnCurrentButton}
                        >
                            <Text style={styles.returnCurrentText}>
                                Return to This Week&apos;s Hunt
                            </Text>
                        </Pressable>
                    )}
                </View>

                {progress.status === 'won' && (
                    <View style={[styles.statusBanner, styles.wonBanner]}>
                        <Text style={styles.statusBannerTitle}>
                            Phrase Solved!
                        </Text>
                        <Text style={styles.statusBannerText}>
                            You uncovered all 10 words on Day {progress.day_index} of 7.
                        </Text>
                    </View>
                )}

                {progress.status === 'lost' && (
                    <View style={[styles.statusBanner, styles.lostBanner]}>
                        <Text style={styles.statusBannerTitle}>
                            Hunt Complete
                        </Text>
                        <Text style={styles.statusBannerText}>
                            All 7 days were used on this phrase. Check the solved words below.
                        </Text>
                    </View>
                )}

                {errorMessage && (
                    <View style={styles.errorBanner}>
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                )}

                <View style={styles.boardCard}>
                    <Text style={styles.sectionTitle}>10-Word Phrase</Text>
                    <Text style={styles.sectionSub}>
                        Orange tags are daily clues. Dark tags are words you locked in.
                    </Text>

                    <View style={styles.slotsGrid}>
                        {progress.slots.map((slot, index) => {
                            const isClue = slot.locked_by === 'daily_clue';
                            const isPlayerLocked = slot.locked_by === 'player';
                            const isLocked = isClue || isPlayerLocked;
                            const invalidWord = invalidSlotMap[index];

                            if (isLocked) {
                                return (
                                    <View
                                        key={slot.index}
                                        style={[
                                            styles.slotBox,
                                            isClue ? styles.clueSlot : styles.playerLockedSlot,
                                        ]}
                                    >
                                        <View style={styles.slotHeader}>
                                            <Text
                                                style={[
                                                    styles.slotIndex,
                                                    isPlayerLocked && styles.slotIndexLight,
                                                ]}
                                            >
                                                {index + 1}
                                            </Text>
                                            {isClue ? (
                                                <BookOpen size={13} color="#FF5A1F" />
                                            ) : (
                                                <Check size={13} color="#FFFFFF" />
                                            )}
                                        </View>
                                        <Text
                                            style={[
                                                styles.lockedWordText,
                                                isPlayerLocked && styles.lockedWordTextLight,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {slot.word}
                                        </Text>
                                    </View>
                                );
                            }

                            return (
                                <View
                                    key={slot.index}
                                    style={[
                                        styles.slotBox,
                                        styles.editableSlot,
                                        Boolean(invalidWord) && styles.invalidSlot,
                                    ]}
                                >
                                    <View style={styles.slotHeader}>
                                        <Text style={styles.slotIndex}>{index + 1}</Text>
                                        {Boolean(invalidWord) && (
                                            <Text style={styles.invalidTag}>Invalid</Text>
                                        )}
                                    </View>
                                    <TextInput
                                        value={draftWords[index] ?? ''}
                                        onChangeText={(val) => handleWordChange(index, val)}
                                        editable={canSubmit}
                                        placeholder={`Word ${index + 1}`}
                                        placeholderTextColor="#A1A1AA"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        spellCheck={false}
                                        style={styles.slotInput}
                                    />
                                </View>
                            );
                        })}
                    </View>

                    <View style={styles.actionsRow}>
                        <Pressable
                            onPress={handleSubmitGuess}
                            disabled={!canSubmit || !allSlotsFilled}
                            style={[
                                styles.submitButton,
                                (!canSubmit || !allSlotsFilled) && styles.disabledButton,
                            ]}
                        >
                            {submitting ? (
                                <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : (
                                <Text style={styles.submitButtonText}>
                                    {isFinished
                                        ? 'Hunt Finished'
                                        : progress.today_guess_used
                                        ? 'Today’s Guess Used'
                                        : 'Submit Today’s Guess'}
                                </Text>
                            )}
                        </Pressable>

                        {!puzzle.is_current_week && isFriend && !isFinished && (
                            <Pressable
                                onPress={handleFastForward}
                                disabled={!canFastForward || fastForwarding}
                                style={[
                                    styles.fastForwardButton,
                                    (!canFastForward || fastForwarding) &&
                                        styles.disabledButton,
                                ]}
                            >
                                {fastForwarding ? (
                                    <ActivityIndicator color="#111111" size="small" />
                                ) : (
                                    <>
                                        <FastForward size={16} color="#111111" />
                                        <Text style={styles.fastForwardText}>
                                            Fast Forward Day
                                        </Text>
                                    </>
                                )}
                            </Pressable>
                        )}
                    </View>
                </View>

                <View style={styles.trayCard}>
                    <Text style={styles.trayTitle}>Spotted Words (Wrong Place)</Text>
                    {progress.misplaced_words.length === 0 ? (
                        <Text style={styles.trayEmpty}>
                            None yet — words that belong in another slot will appear here.
                        </Text>
                    ) : (
                        <View style={styles.chipsWrap}>
                            {progress.misplaced_words.map((word) => (
                                <View key={word} style={styles.misplacedChip}>
                                    <Text style={styles.misplacedChipText}>{word}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                <View style={styles.trayCard}>
                    <Text style={styles.trayTitle}>Not in Phrase (Eliminated)</Text>
                    {progress.eliminated_words.length === 0 ? (
                        <Text style={styles.trayEmpty}>
                            None yet — guessed words not in the phrase appear here.
                        </Text>
                    ) : (
                        <View style={styles.chipsWrap}>
                            {progress.eliminated_words.map((word) => (
                                <View key={word} style={styles.eliminatedChip}>
                                    <Text style={styles.eliminatedChipText}>{word}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                <Modal
                    visible={rulesOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setRulesOpen(false)}
                >
                    <View style={styles.modalBackdrop}>
                        <View style={styles.modalCard}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Fox Hunt Rules</Text>
                                <Pressable onPress={() => setRulesOpen(false)}>
                                    <X size={20} color="#111111" />
                                </Pressable>
                            </View>
                            <View style={styles.rulesList}>
                                <Text style={styles.ruleItem}>
                                    1. Each Fox Hunt runs Saturday to Friday with a 10-word phrase.
                                </Text>
                                <Text style={styles.ruleItem}>
                                    2. One clue word is revealed on Saturday, plus 1 new guess and 1 new clue each day through Friday.
                                </Text>
                                <Text style={styles.ruleItem}>
                                    3. Correct words lock into their slot. Words that belong somewhere else appear in Spotted Words; misses move to Not in Phrase.
                                </Text>
                                <Text style={styles.ruleItem}>
                                    4. Every slot must be a valid dictionary word — typos are highlighted without spending your daily guess.
                                </Text>
                                <Text style={styles.ruleItem}>
                                    5. Friend unlock gives access to past archived hunts and Fast Forward (disabled on the current week).
                                </Text>
                            </View>
                        </View>
                    </View>
                </Modal>

                <Modal
                    visible={archiveOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setArchiveOpen(false)}
                >
                    <View style={styles.modalBackdrop}>
                        <View style={styles.modalCard}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Past Fox Hunts</Text>
                                <Pressable onPress={() => setArchiveOpen(false)}>
                                    <X size={20} color="#111111" />
                                </Pressable>
                            </View>

                            {!isFriend ? (
                                <View style={styles.lockedArchiveBox}>
                                    <Lock size={20} color="#71717A" />
                                    <Text style={styles.lockedArchiveText}>
                                        Sign in with a Friend unlock to replay past weekly Fox Hunts and use Fast Forward.
                                    </Text>
                                </View>
                            ) : archiveLoading ? (
                                <ActivityIndicator color="#FF5A1F" style={styles.loaderPad} />
                            ) : archiveItems.length === 0 ? (
                                <Text style={styles.trayEmpty}>
                                    No past archived Fox Hunts available yet.
                                </Text>
                            ) : (
                                <ScrollView style={styles.archiveList}>
                                    {archiveItems.map((item) => (
                                        <Pressable
                                            key={item.id}
                                            onPress={() => loadArchivedHunt(item.share_code)}
                                            style={styles.archiveItem}
                                        >
                                            <Text style={styles.archiveItemTitle}>
                                                {item.title}
                                            </Text>
                                            <Text style={styles.archiveItemDates}>
                                                {item.starts_on} to {item.ends_on}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </ScrollView>
                            )}
                        </View>
                    </View>
                </Modal>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    screen: {
        flex: 1,
        backgroundColor: '#FAFAFA',
    },
    content: {
        padding: 16,
        paddingBottom: 40,
        gap: 16,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 12,
    },
    backButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111111',
    },
    topActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    iconButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 12,
    },
    iconButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#111111',
    },
    headerCard: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 16,
        padding: 16,
        gap: 6,
    },
    headerMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    eyebrow: {
        fontSize: 12,
        fontWeight: '700',
        color: '#FF5A1F',
    },
    dayBadge: {
        fontSize: 12,
        fontWeight: '700',
        color: '#111111',
        backgroundColor: '#F4F4F5',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#111111',
    },
    hint: {
        fontSize: 14,
        color: '#52525B',
    },
    returnCurrentButton: {
        marginTop: 6,
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: '#FFF4EE',
        borderRadius: 8,
    },
    returnCurrentText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#FF5A1F',
    },
    statusBanner: {
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        gap: 4,
    },
    wonBanner: {
        backgroundColor: '#ECFDF5',
        borderColor: '#A7F3D0',
    },
    lostBanner: {
        backgroundColor: '#F4F4F5',
        borderColor: '#D4D4D8',
    },
    statusBannerTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#111111',
    },
    statusBannerText: {
        fontSize: 13,
        color: '#3F3F46',
    },
    errorBanner: {
        backgroundColor: '#FEF2F2',
        borderWidth: 1,
        borderColor: '#FECACA',
        borderRadius: 14,
        padding: 12,
    },
    errorText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#991B1B',
        lineHeight: 18,
    },
    boardCard: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 16,
        padding: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#111111',
    },
    sectionSub: {
        fontSize: 12,
        color: '#71717A',
    },
    slotsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    slotBox: {
        width: '48%',
        borderRadius: 12,
        borderWidth: 1,
        padding: 10,
        gap: 4,
    },
    clueSlot: {
        backgroundColor: '#FFF4EE',
        borderColor: '#FDBA74',
    },
    playerLockedSlot: {
        backgroundColor: '#111111',
        borderColor: '#111111',
    },
    editableSlot: {
        backgroundColor: '#FAFAFA',
        borderColor: '#D4D4D8',
    },
    invalidSlot: {
        backgroundColor: '#FEF2F2',
        borderColor: '#DC2626',
        borderWidth: 1.5,
    },
    slotHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    slotIndex: {
        fontSize: 11,
        fontWeight: '700',
        color: '#71717A',
    },
    slotIndexLight: {
        color: '#D4D4D8',
    },
    invalidTag: {
        fontSize: 11,
        fontWeight: '700',
        color: '#DC2626',
    },
    lockedWordText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111111',
    },
    lockedWordTextLight: {
        color: '#FFFFFF',
    },
    slotInput: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111111',
        paddingVertical: 2,
    },
    actionsRow: {
        gap: 10,
        marginTop: 4,
    },
    submitButton: {
        backgroundColor: '#FF5A1F',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    fastForwardButton: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#D4D4D8',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fastForwardText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#111111',
    },
    disabledButton: {
        opacity: 0.45,
    },
    trayCard: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    trayTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111111',
    },
    trayEmpty: {
        fontSize: 13,
        color: '#71717A',
    },
    chipsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    misplacedChip: {
        backgroundColor: '#FFF4EE',
        borderWidth: 1,
        borderColor: '#FDBA74',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    misplacedChipText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#C2410C',
    },
    eliminatedChip: {
        backgroundColor: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    eliminatedChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#71717A',
        textDecorationLine: 'line-through',
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(17, 17, 17, 0.5)',
        justifyContent: 'center',
        padding: 20,
    },
    modalCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        padding: 20,
        gap: 14,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#111111',
    },
    rulesList: {
        gap: 10,
    },
    ruleItem: {
        fontSize: 14,
        lineHeight: 20,
        color: '#3F3F46',
    },
    lockedArchiveBox: {
        alignItems: 'center',
        gap: 10,
        paddingVertical: 16,
    },
    lockedArchiveText: {
        fontSize: 14,
        color: '#52525B',
        textAlign: 'center',
        lineHeight: 20,
    },
    loaderPad: {
        paddingVertical: 20,
    },
    archiveList: {
        maxHeight: 320,
    },
    archiveItem: {
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E4E4E7',
        gap: 2,
    },
    archiveItemTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111111',
    },
    archiveItemDates: {
        fontSize: 12,
        color: '#71717A',
    },
});