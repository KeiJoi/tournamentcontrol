/** Generic single-elimination layout; no game-specific outcome logic. */
export interface SeededContestant { id: string; seed: number; }
export interface PlannedRound { number: number; name: string; }
export interface PlannedMatch { round: number; position: number; player1Id: string | null; player2Id: string | null; nextRound: number | null; nextPosition: number | null; nextSlot: 1 | 2 | null; }
export interface BracketPlan { size: number; rounds: PlannedRound[]; matches: PlannedMatch[]; }

export function createSingleEliminationPlan(contestants: readonly SeededContestant[]): BracketPlan {
  if (contestants.length < 2) throw new Error("At least two contestants are required.");
  const size = nextPowerOfTwo(contestants.length);
  const bySeed = new Map(contestants.map((contestant) => [contestant.seed, contestant.id]));
  const slots = seedOrder(size).map((seed) => bySeed.get(seed) ?? null);
  const roundCount = Math.log2(size);
  const rounds = Array.from({ length: roundCount }, (_, index) => ({ number: index + 1, name: index + 1 === roundCount ? "Final" : `Round ${index + 1}` }));
  const matches: PlannedMatch[] = [];
  for (let round = 1; round <= roundCount; round++) {
    const count = size / 2 ** round;
    for (let index = 0; index < count; index++) matches.push({
      round, position: index + 1,
      player1Id: round === 1 ? slots[index * 2]! : null, player2Id: round === 1 ? slots[index * 2 + 1]! : null,
      nextRound: round === roundCount ? null : round + 1, nextPosition: round === roundCount ? null : Math.floor(index / 2) + 1, nextSlot: round === roundCount ? null : index % 2 === 0 ? 1 : 2,
    });
  }
  return { size, rounds, matches };
}

function nextPowerOfTwo(value: number): number { let size = 2; while (size < value) size *= 2; return size; }
function seedOrder(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) { const nextSize = seeds.length * 2; seeds = seeds.flatMap((seed) => [seed, nextSize + 1 - seed]); }
  return seeds;
}
