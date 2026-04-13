/**
 * @module exporter
 * Export the palace as a browsable folder of markdown files.
 *
 * Produces:
 *   output_dir/
 *     index.md              — table of contents
 *     wing_name/
 *       room_name.md        — one file per room, drawers as sections
 *
 * Streams drawers in paginated batches so memory usage stays bounded
 * regardless of palace size.
 *
 * 1:1 PORT from original exporter.py
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { getCollection, getDrawers, drawerCount } from './chroma.js';
import type { ChromaCollection } from './chroma.js';

/** Export stats returned by {@link exportPalace}. */
interface ExportStats {
  wings: number;
  rooms: number;
  drawers: number;
}

/**
 * Sanitize a string for use as a directory or file name component.
 *
 * Python: exporter.py _safe_path_component()
 *
 * @param name - Raw name to sanitize
 * @returns File-system-safe string
 */
function _safePathComponent(name: string): string {
  let safe = name.replace(/[/\\:*?"<>|]/g, '_');
  safe = safe.replace(/^[.\s]+|[.\s]+$/g, '');
  return safe || 'unknown';
}

/**
 * Format content for a markdown blockquote, handling multiline.
 *
 * Python: exporter.py _quote_content()
 *
 * @param text - Raw text to quote
 * @returns Markdown blockquote string (without leading `> `)
 */
function _quoteContent(text: string): string {
  const lines = text.replace(/\n+$/, '').split('\n');
  return lines.join('\n> ');
}

/**
 * Export all palace drawers as markdown files organized by wing/room.
 *
 * Streams drawers in batches of 1000 and writes each wing/room file
 * incrementally, keeping memory usage proportional to batch size rather
 * than total palace size.
 *
 * Python: exporter.py export_palace()
 *
 * @param options - Export options
 * @param options.collectionName - Optional collection name override
 * @param options.outputDir - Where to write the exported markdown tree
 * @param options.format - Output format (currently only "markdown")
 * @returns Stats: wings, rooms, and drawers exported
 */
export async function exportPalace(options: {
  collectionName?: string;
  outputDir: string;
  format?: string;
}): Promise<ExportStats> {
  const { collectionName, outputDir, format = 'markdown' } = options;

  const col = await getCollection(collectionName);
  const total = await drawerCount(col);

  if (total === 0) {
    console.log('  Palace is empty — nothing to export.');
    return { wings: 0, rooms: 0, drawers: 0 };
  }

  mkdirSync(outputDir, { recursive: true });

  // Track which room files have been opened (so we can write header vs append)
  const openedRooms = new Set<string>();

  // Track stats per wing: wing -> room -> count
  const wingStats: Record<string, Record<string, number>> = {};

  let totalDrawers = 0;

  console.log(`  Streaming ${total} drawers...`);

  let offset = 0;
  const batchSize = 1000;

  while (offset < total) {
    const batch = await getDrawers(col, undefined, undefined, batchSize, offset);
    if (batch.length === 0) break;

    // Group this batch by wing/room so we do one file write per room per batch
    const batchGrouped: Record<string, Record<string, Array<{
      id: string;
      content: string;
      source: string;
      filedAt: string;
      addedBy: string;
    }>>> = {};

    for (const drawer of batch) {
      const wing = String(drawer.metadata.wing ?? 'unknown');
      const room = String(drawer.metadata.room ?? 'general');

      if (!batchGrouped[wing]) batchGrouped[wing] = {};
      if (!batchGrouped[wing][room]) batchGrouped[wing][room] = [];

      batchGrouped[wing][room].push({
        id: drawer.id,
        content: drawer.content,
        source: String(drawer.metadata.source_file ?? ''),
        filedAt: String(drawer.metadata.filed_at ?? ''),
        addedBy: String(drawer.metadata.added_by ?? ''),
      });
    }

    // Write/append each room file
    for (const [wing, rooms] of Object.entries(batchGrouped)) {
      const safeWing = _safePathComponent(wing);
      const wingDir = join(outputDir, safeWing);
      mkdirSync(wingDir, { recursive: true });

      for (const [room, drawers] of Object.entries(rooms)) {
        const safeRoom = _safePathComponent(room);
        const roomPath = join(wingDir, `${safeRoom}.md`);
        const key = `${wing}\0${room}`;
        const isNew = !openedRooms.has(key);

        let content = '';

        if (isNew) {
          content += `# ${wing} / ${room}\n\n`;
          openedRooms.add(key);
        }

        for (const drawer of drawers) {
          const source = drawer.source || 'unknown';
          const filed = drawer.filedAt || 'unknown';
          const addedBy = drawer.addedBy || 'unknown';

          content +=
            `## ${drawer.id}\n` +
            `\n` +
            `> ${_quoteContent(drawer.content)}\n` +
            `\n` +
            `| Field | Value |\n` +
            `|-------|-------|\n` +
            `| Source | ${source} |\n` +
            `| Filed | ${filed} |\n` +
            `| Added by | ${addedBy} |\n` +
            `\n` +
            `---\n\n`;
        }

        if (isNew) {
          writeFileSync(roomPath, content, 'utf-8');
        } else {
          // Append by reading existing content — node:fs appendFileSync would also work
          const { appendFileSync } = await import('node:fs');
          appendFileSync(roomPath, content, 'utf-8');
        }

        if (!wingStats[wing]) wingStats[wing] = {};
        wingStats[wing][room] = (wingStats[wing][room] ?? 0) + drawers.length;
        totalDrawers += drawers.length;
      }
    }

    offset += batch.length;
  }

  // Build and print stats
  const indexRows: Array<{ wing: string; roomCount: number; drawerCount: number }> = [];

  for (const wing of Object.keys(wingStats).sort()) {
    const rooms = wingStats[wing];
    const wingDrawerCount = Object.values(rooms).reduce((sum, n) => sum + n, 0);
    const roomCount = Object.keys(rooms).length;
    indexRows.push({ wing, roomCount, drawerCount: wingDrawerCount });
    console.log(`  ${wing}: ${roomCount} rooms, ${wingDrawerCount} drawers`);
  }

  // Write index.md
  const today = new Date().toISOString().slice(0, 10);
  const indexLines: string[] = [
    `# Palace Export — ${today}\n`,
    '',
    '| Wing | Rooms | Drawers |',
    '|------|-------|---------|',
  ];

  for (const { wing, roomCount, drawerCount: dc } of indexRows) {
    indexLines.push(`| [${wing}](${wing}/) | ${roomCount} | ${dc} |`);
  }
  indexLines.push('');

  const indexPath = join(outputDir, 'index.md');
  writeFileSync(indexPath, indexLines.join('\n'), 'utf-8');

  const stats: ExportStats = {
    wings: Object.keys(wingStats).length,
    rooms: indexRows.reduce((sum, r) => sum + r.roomCount, 0),
    drawers: totalDrawers,
  };

  console.log(
    `\n  Exported ${stats.drawers} drawers across ${stats.wings} wings, ${stats.rooms} rooms`,
  );
  console.log(`  Output: ${outputDir}`);

  return stats;
}
