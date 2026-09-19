// rapidfuzz の fuzz.ratio / partial_ratio 相当 (Indel 距離ベース、0..100)

function lcs(a: string, b: string): number {
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  return (200 * lcs(a, b)) / (a.length + b.length);
}

/** 短い方を長い方の部分文字列 (同じ長さの窓) と比べた最大値 */
export function partialRatio(a: string, b: string): number {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (!s.length) return 0;
  let best = 0;
  for (let i = -s.length + 1; i < l.length; i++) {
    const win = l.slice(Math.max(0, i), Math.max(0, i + s.length));
    if (!win.length) continue;
    best = Math.max(best, ratio(s, win));
    if (best === 100) break;
  }
  return best;
}
