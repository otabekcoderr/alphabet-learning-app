/**
 * Unbiased Fisher–Yates shuffle without mutating the input array.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const raw = rng();
    const clamped = Number.isFinite(raw) ? Math.min(0.999999999999, Math.max(0, raw)) : 0;
    const j = Math.floor(clamped * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Shuffle options using Fisher–Yates and avoid placing the correct answer at
 * `previousCorrectIndex` twice in a row (when >= 2 non-identical slots exist).
 */
export function shuffleOptionsWithAntiStreak<T>(
  options: readonly T[],
  isCorrectFn: (option: T) => boolean,
  previousCorrectIndex: number | null | undefined = null,
  rng: () => number = Math.random,
): T[] {
  const arr = fisherYatesShuffle(options, rng);
  if (
    arr.length <= 1 ||
    previousCorrectIndex === null ||
    previousCorrectIndex === undefined ||
    previousCorrectIndex < 0 ||
    previousCorrectIndex >= arr.length
  ) {
    return arr;
  }

  const currentCorrectIdx = arr.findIndex(isCorrectFn);
  if (currentCorrectIdx === -1 || currentCorrectIdx !== previousCorrectIndex) {
    return arr;
  }

  const alternativeIndices: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i !== currentCorrectIdx && !isCorrectFn(arr[i]!)) {
      alternativeIndices.push(i);
    }
  }
  if (alternativeIndices.length === 0) {
    for (let i = 0; i < arr.length; i++) {
      if (i !== currentCorrectIdx) alternativeIndices.push(i);
    }
  }

  if (alternativeIndices.length > 0) {
    const raw = rng();
    const clamped = Number.isFinite(raw) ? Math.min(0.999999999999, Math.max(0, raw)) : 0;
    const swapIdx = alternativeIndices[Math.floor(clamped * alternativeIndices.length)]!;
    const tmp = arr[currentCorrectIdx]!;
    arr[currentCorrectIdx] = arr[swapIdx]!;
    arr[swapIdx] = tmp;
  }

  return arr;
}
