export type Difficulty = "Past" | "Present" | "Future" | "Eternal" | "Beyond";

export interface Chart {
  id: string; // `${songId}:${difficulty}` (ゲーム内の曲ID。Tachi の ID には依存しない)
  songId: string;
  title: string;
  artist: string;
  pack: string;
  names: string[]; // 曲名 + 別名 + 検索語 (あいまい一致用)
  difficulty: Difficulty;
  level: string; // "10", "9+" など
  constant: number;
  notes: number | null;
}

export const DIFFICULTIES: Difficulty[] = ["Past", "Present", "Future", "Eternal", "Beyond"];
export const DIFF_ABBR: Record<Difficulty, string> = {
  Past: "PST", Present: "PRS", Future: "FTR", Eternal: "ETR", Beyond: "BYD",
};
