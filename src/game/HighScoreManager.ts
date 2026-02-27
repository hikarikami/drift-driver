export interface HighScoreEntry {
    playerName: string;
    score: number;
    duration: number; // seconds
}

const STORAGE_KEY = 'drift_highscores_v2';
const MAX_SCORES = 5;

function loadBoard(): HighScoreEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveBoard(entries: HighScoreEntry[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // Silently ignore storage errors (e.g. private browsing quota)
    }
}

export const HighScoreManager = {
    /**
     * Returns the global top scores sorted best-first (up to 5 entries).
     */
    getTopScores(): HighScoreEntry[] {
        return loadBoard();
    },

    /**
     * Adds a score to the global leaderboard. Keeps only the top 5.
     * Returns the 1-based rank (1–5) if it placed, or null if it didn't make the cut.
     */
    saveScore(playerName: string, score: number, duration: number): number | null {
        const board = loadBoard();

        const newEntry: HighScoreEntry = { playerName, score, duration };

        const updated = [...board, newEntry]
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_SCORES);

        // Reference equality — did our entry survive the cut?
        const idx = updated.indexOf(newEntry);
        if (idx === -1) return null;

        saveBoard(updated);
        return idx + 1;
    },
};
