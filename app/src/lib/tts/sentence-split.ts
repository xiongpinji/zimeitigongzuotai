const SENTENCE_END = /[。！？；!?;]+(?:["'"'）)】」』]+)?/g;

/**
 * 把文本按中英句末标点切分，保留标点；换行/多空白归一为单空格后再切。
 * 末尾无句末标点的残余作为最后一句。空白输入返回 []。
 */
export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  let lastIndex = 0;
  for (const match of normalized.matchAll(SENTENCE_END)) {
    const end = match.index! + match[0].length;
    const piece = normalized.slice(lastIndex, end).trim();
    if (piece) sentences.push(piece);
    lastIndex = end;
  }
  const tail = normalized.slice(lastIndex).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
