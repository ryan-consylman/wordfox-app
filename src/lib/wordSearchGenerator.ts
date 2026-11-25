export interface WordPlacement {
    word: string;
    cells: Array<{ row: number; col: number }>;
}

export interface WordSearchBoard {
    size: number;
    grid: string[][];
    placements: WordPlacement[];
    words: string[];
}

type AxisKey = 'H' | 'V' | 'D1' | 'D2';

const DIRECTIONS: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1],
];

const FILLER_ALPHABET =
    'EEEEEEEEEEAAAAAAAARRRRRRIIIIIIOOOOOOTTTTTTNNNNNNSSSSSSLLLLCCCCUUUUDDDPPPMMMHHGGBBFFYYWWKVXZJQ';

function getAxisKey(dr: number, dc: number): AxisKey {
    if (dr === 0) return 'H';
    if (dc === 0) return 'V';
    if (dr === dc) return 'D1';
    return 'D2';
}

function hashSeed(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function createPrng(seed: string): () => number {
    let state = hashSeed(seed) || 1;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function generateWordSearchBoard(
    words: string[],
    seedStr: string,
    size = 10
): WordSearchBoard {
    const rng = createPrng(seedStr);
    const sortedWords = [...words]
        .map((w) => w.toUpperCase().replace(/[^A-Z]/g, ''))
        .filter((w) => w.length >= 2 && w.length <= size)
        .sort((a, b) => b.length - a.length);

    for (let attempt = 0; attempt < 60; attempt++) {
        const grid: string[][] = Array.from({ length: size }, () =>
            Array(size).fill('')
        );
        const cellAxes: AxisKey[][][] = Array.from({ length: size }, () =>
            Array.from({ length: size }, () => [])
        );
        const placements: WordPlacement[] = [];
        let allPlaced = true;

        for (const word of sortedWords) {
            let placed = false;
            const candidates: Array<{ r: number; c: number; dr: number; dc: number }> = [];

            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    for (const [dr, dc] of DIRECTIONS) {
                        const endR = r + dr * (word.length - 1);
                        const endC = c + dc * (word.length - 1);
                        if (endR >= 0 && endR < size && endC >= 0 && endC < size) {
                            candidates.push({ r, c, dr, dc });
                        }
                    }
                }
            }

            const shuffled = shuffleWithRng(candidates, rng);
            for (const { r, c, dr, dc } of shuffled) {
                const axis = getAxisKey(dr, dc);
                let canPlace = true;

                for (let i = 0; i < word.length; i++) {
                    const nr = r + dr * i;
                    const nc = c + dc * i;
                    const existingChar = grid[nr][nc];

                    if (existingChar !== '') {
                        if (existingChar !== word[i] || cellAxes[nr][nc].includes(axis)) {
                            canPlace = false;
                            break;
                        }
                    }
                }

                if (canPlace) {
                    const cells: Array<{ row: number; col: number }> = [];
                    for (let i = 0; i < word.length; i++) {
                        const nr = r + dr * i;
                        const nc = c + dc * i;
                        grid[nr][nc] = word[i];
                        cellAxes[nr][nc].push(axis);
                        cells.push({ row: nr, col: nc });
                    }
                    placements.push({ word, cells });
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                allPlaced = false;
                break;
            }
        }

        if (allPlaced) {
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (grid[r][c] === '') {
                        grid[r][c] =
                            FILLER_ALPHABET[Math.floor(rng() * FILLER_ALPHABET.length)];
                    }
                }
            }

            return {
                size,
                grid,
                placements,
                words: sortedWords,
            };
        }
    }

    const fallbackGrid: string[][] = Array.from({ length: size }, (_, r) =>
        Array.from(
            { length: size },
            (_, c) => FILLER_ALPHABET[(r * size + c) % FILLER_ALPHABET.length]
        )
    );
    const fallbackPlacements: WordPlacement[] = [];
    sortedWords.slice(0, size).forEach((word, rowIdx) => {
        const cells: Array<{ row: number; col: number }> = [];
        for (let i = 0; i < word.length; i++) {
            fallbackGrid[rowIdx][i] = word[i];
            cells.push({ row: rowIdx, col: i });
        }
        fallbackPlacements.push({ word, cells });
    });

    return {
        size,
        grid: fallbackGrid,
        placements: fallbackPlacements,
        words: sortedWords.slice(0, size),
    };
}

export function getLineCells(
    start: { row: number; col: number },
    end: { row: number; col: number },
    size = 10
): Array<{ row: number; col: number }> {
    const dr = end.row - start.row;
    const dc = end.col - start.col;

    if (dr === 0 && dc === 0) return [start];

    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    let stepR = 0;
    let stepC = 0;
    let length = 0;

    if (absR === 0) {
        stepC = dc > 0 ? 1 : -1;
        length = absC;
    } else if (absC === 0) {
        stepR = dr > 0 ? 1 : -1;
        length = absR;
    } else if (absR === absC) {
        stepR = dr > 0 ? 1 : -1;
        stepC = dc > 0 ? 1 : -1;
        length = absR;
    } else if (absR > absC * 2) {
        stepR = dr > 0 ? 1 : -1;
        length = absR;
    } else if (absC > absR * 2) {
        stepC = dc > 0 ? 1 : -1;
        length = absC;
    } else {
        stepR = dr > 0 ? 1 : -1;
        stepC = dc > 0 ? 1 : -1;
        length = Math.max(absR, absC);
    }

    const cells: Array<{ row: number; col: number }> = [];
    for (let i = 0; i <= length; i++) {
        const nr = start.row + stepR * i;
        const nc = start.col + stepC * i;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) {
            break;
        }
        cells.push({ row: nr, col: nc });
    }
    return cells;
}

export function formatSeconds(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}