export interface LeaderboardEntry {
    playerName: string;
    score: number;
    duration: number;
    airTime: number;
}

export interface PlayerContext {
    /** 1-based global rank for this run */
    rank: number;
    /** Nearest entry with a strictly higher score */
    above: LeaderboardEntry | null;
    /** Nearest entry with a strictly lower score */
    below: LeaderboardEntry | null;
    myEntry: LeaderboardEntry;
}

const BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/rest/v1/scores`;
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function hdrs(extra?: Record<string, string>): Record<string, string> {
    return {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...extra,
    };
}

function toEntry(row: { player_name: string; score: number; duration: number; air_time?: number }): LeaderboardEntry {
    return {
        playerName: row.player_name,
        score: row.score,
        duration: row.duration,
        airTime: row.air_time ?? 0,
    };
}

export const LeaderboardService = {
    /**
     * Submits a new score to the global leaderboard.
     */
    async submitScore(playerName: string, score: number, duration: number, airTime: number): Promise<void> {
        const res = await fetch(BASE, {
            method: 'POST',
            headers: hdrs({ Prefer: 'return=minimal' }),
            body: JSON.stringify({
                player_name: playerName,
                score: Math.round(score),
                duration: Math.round(duration),
                air_time: Math.round(airTime * 10) / 10,
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`LeaderboardService.submitScore failed (${res.status}): ${text}`);
        }
    },

    /**
     * Fetches the top N global scores, best first.
     * Ties broken by duration descending (longer run = higher rank).
     */
    async getTopScores(limit = 10): Promise<LeaderboardEntry[]> {
        const res = await fetch(
            `${BASE}?select=player_name,score,duration,air_time&order=score.desc,duration.desc&limit=${limit}`,
            { headers: hdrs() },
        );
        if (!res.ok) {
            throw new Error(`LeaderboardService.getTopScores failed (${res.status})`);
        }
        const rows: { player_name: string; score: number; duration: number; air_time?: number }[] = await res.json();
        return rows.map(toEntry);
    },

    /**
     * Returns the player's global rank plus the nearest entries above and below.
     * Rank = (# of entries that beat this run under score DESC, duration DESC) + 1.
     * A tie on score is broken by duration: a longer run ranks higher.
     */
    async getPlayerContext(playerName: string, score: number, duration: number, airTime: number = 0): Promise<PlayerContext> {
        // Round to integers to match the int4 column type used in filter expressions
        const s = Math.round(score);
        const d = Math.round(duration);

        // "Beats this run" means: higher score, OR same score with longer duration
        const beatsMe   = `or=(score.gt.${s},and(score.eq.${s},duration.gt.${d}))`;
        const loseToMe  = `or=(score.lt.${s},and(score.eq.${s},duration.lt.${d}))`;

        const [rankRes, aboveRes, belowRes] = await Promise.all([
            // Count all rows that strictly outrank this run
            fetch(`${BASE}?select=id&${beatsMe}`, {
                headers: hdrs({ Prefer: 'count=exact' }),
            }),
            // Nearest entry above: the closest run that just beats this one
            fetch(`${BASE}?select=player_name,score,duration,air_time&${beatsMe}&order=score.asc,duration.asc&limit=1`, {
                headers: hdrs(),
            }),
            // Nearest entry below: the closest run that this one just beats
            fetch(`${BASE}?select=player_name,score,duration,air_time&${loseToMe}&order=score.desc,duration.desc&limit=1`, {
                headers: hdrs(),
            }),
        ]);

        // Content-Range format: "0-N/TOTAL" when rows exist, "*/TOTAL" when empty
        const range = rankRes.headers.get('content-range') ?? '*/0';
        const totalStr = range.split('/')[1] ?? '0';
        const total = parseInt(totalStr, 10);
        const rank = isNaN(total) ? 1 : total + 1;

        const aboveRows: { player_name: string; score: number; duration: number; air_time?: number }[] =
            aboveRes.ok ? await aboveRes.json() : [];
        const belowRows: { player_name: string; score: number; duration: number; air_time?: number }[] =
            belowRes.ok ? await belowRes.json() : [];

        return {
            rank,
            above: aboveRows[0] ? toEntry(aboveRows[0]) : null,
            below: belowRows[0] ? toEntry(belowRows[0]) : null,
            myEntry: { playerName, score, duration, airTime },
        };
    },
};
