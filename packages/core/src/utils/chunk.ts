/**
 * @module utils/chunk
 * Text chunking with overlap and intelligent boundary detection.
 *
 * 1:1 PORT from original miner.py chunk_text()
 * Chunks text at paragraph or line boundaries with configurable overlap.
 */

import { CHUNK_SIZE, CHUNK_OVERLAP, MIN_CHUNK_SIZE } from '../types.js';
import type { TextChunk } from '../types.js';

/**
 * Chunk text into overlapping segments, preferring paragraph/line boundaries.
 *
 * Python: miner.py chunk_text()
 * Algorithm:
 *   1. Start at position 0
 *   2. Look ahead CHUNK_SIZE chars
 *   3. Find nearest paragraph break (\n\n) in the second half
 *   4. Failing that, find nearest line break (\n) in the second half
 *   5. Failing that, break at CHUNK_SIZE
 *   6. Advance by (break_point - CHUNK_OVERLAP) for overlap
 *
 * @param content - Text to chunk
 * @param chunkSize - Maximum characters per chunk (default: 800)
 * @param overlap - Overlap between chunks (default: 100)
 * @returns Array of text chunks with sequential indices
 */
export function chunkText(
  content: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);

    // Try to break at a paragraph boundary (\n\n) in the second half
    if (end < content.length) {
      const halfPoint = start + Math.floor(chunkSize / 2);
      const paraBreak = content.lastIndexOf('\n\n', end);
      if (paraBreak > halfPoint) {
        end = paraBreak;
      } else {
        // Try line break
        const lineBreak = content.lastIndexOf('\n', end);
        if (lineBreak > halfPoint) {
          end = lineBreak;
        }
      }
    }

    const chunk = content.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_SIZE) {
      chunks.push({ content: chunk, chunk_index: chunks.length });
    }

    // Advance with overlap
    start = end < content.length ? end - overlap : end;
  }

  return chunks;
}
