/**
 * @module room-detector
 * Local room detection — no API required.
 *
 * 1:1 PORT from original room_detector_local.py
 *
 * Two ways to define rooms without calling any AI:
 *   1. Auto-detect from folder structure (zero config)
 *   2. Define manually in mempalace.yaml
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomConfig } from './types.js';
import { SKIP_DIRS } from './types.js';
import { resolvePath } from './utils/paths.js';

/**
 * Common room patterns — detected from folder names and filenames.
 * Python: room_detector_local.py FOLDER_ROOM_MAP (94 entries)
 */
export const FOLDER_ROOM_MAP: Record<string, string> = {
  // Frontend
  frontend: 'frontend',
  'front-end': 'frontend',
  front_end: 'frontend',
  client: 'frontend',
  ui: 'frontend',
  views: 'frontend',
  components: 'frontend',
  pages: 'frontend',
  // Backend
  backend: 'backend',
  'back-end': 'backend',
  back_end: 'backend',
  server: 'backend',
  api: 'backend',
  routes: 'backend',
  services: 'backend',
  controllers: 'backend',
  models: 'backend',
  database: 'backend',
  db: 'backend',
  // Documentation
  docs: 'documentation',
  doc: 'documentation',
  documentation: 'documentation',
  wiki: 'documentation',
  readme: 'documentation',
  notes: 'documentation',
  // Design
  design: 'design',
  designs: 'design',
  mockups: 'design',
  wireframes: 'design',
  assets: 'design',
  storyboard: 'design',
  // Costs
  costs: 'costs',
  cost: 'costs',
  budget: 'costs',
  finance: 'costs',
  financial: 'costs',
  pricing: 'costs',
  invoices: 'costs',
  accounting: 'costs',
  // Meetings
  meetings: 'meetings',
  meeting: 'meetings',
  calls: 'meetings',
  meeting_notes: 'meetings',
  standup: 'meetings',
  minutes: 'meetings',
  // Team
  team: 'team',
  staff: 'team',
  hr: 'team',
  hiring: 'team',
  employees: 'team',
  people: 'team',
  // Research
  research: 'research',
  references: 'research',
  reading: 'research',
  papers: 'research',
  // Planning
  planning: 'planning',
  roadmap: 'planning',
  strategy: 'planning',
  specs: 'planning',
  requirements: 'planning',
  // Testing
  tests: 'testing',
  test: 'testing',
  testing: 'testing',
  qa: 'testing',
  // Scripts
  scripts: 'scripts',
  tools: 'scripts',
  utils: 'scripts',
  // Configuration
  config: 'configuration',
  configs: 'configuration',
  settings: 'configuration',
  infrastructure: 'configuration',
  infra: 'configuration',
  deploy: 'configuration',
};

/**
 * Walk the project folder structure and detect rooms from folder names.
 *
 * Python: room_detector_local.py detect_rooms_from_folders(project_dir) -> list
 */
export function detectRoomsFromFolders(projectDir: string): RoomConfig[] {
  const resolved = resolvePath(projectDir);
  const foundRooms = new Map<string, string>(); // room_name -> original folder name

  // Check top-level directories first (most reliable signal)
  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const nameLower = entry.name.toLowerCase().replace(/-/g, '_');

      if (nameLower in FOLDER_ROOM_MAP) {
        const roomName = FOLDER_ROOM_MAP[nameLower];
        if (!foundRooms.has(roomName)) {
          foundRooms.set(roomName, entry.name);
        }
      } else if (entry.name.length > 2 && /^[a-zA-Z]/.test(entry.name)) {
        const clean = entry.name.toLowerCase().replace(/[-\s]/g, '_');
        if (!foundRooms.has(clean)) {
          foundRooms.set(clean, entry.name);
        }
      }
    }

    // Walk one level deeper for nested patterns
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      try {
        const subEntries = readdirSync(join(resolved, entry.name), { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (!subEntry.isDirectory() || SKIP_DIRS.has(subEntry.name)) continue;
          const nameLower = subEntry.name.toLowerCase().replace(/-/g, '_');
          if (nameLower in FOLDER_ROOM_MAP) {
            const roomName = FOLDER_ROOM_MAP[nameLower];
            if (!foundRooms.has(roomName)) {
              foundRooms.set(roomName, subEntry.name);
            }
          }
        }
      } catch {
        // permission errors
      }
    }
  } catch {
    // directory read errors
  }

  // Build room list
  const rooms: RoomConfig[] = [];
  for (const [roomName, original] of foundRooms) {
    rooms.push({
      name: roomName,
      description: `Files from ${original}/`,
      keywords: [roomName, original.toLowerCase()],
    });
  }

  // Always add "general" as fallback
  if (!rooms.some((r) => r.name === 'general')) {
    rooms.push({
      name: 'general',
      description: "Files that don't fit other rooms",
      keywords: [],
    });
  }

  return rooms;
}

/**
 * Fallback: detect rooms from recurring filename patterns.
 *
 * Python: room_detector_local.py detect_rooms_from_files(project_dir) -> list
 */
export function detectRoomsFromFiles(projectDir: string): RoomConfig[] {
  const resolved = resolvePath(projectDir);
  const keywordCounts = new Map<string, number>();

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(fullPath);
        } else if (entry.isFile()) {
          const nameLower = entry.name.toLowerCase().replace(/[-\s]/g, '_');
          for (const [keyword, room] of Object.entries(FOLDER_ROOM_MAP)) {
            if (nameLower.includes(keyword)) {
              keywordCounts.set(room, (keywordCounts.get(room) ?? 0) + 1);
            }
          }
        }
      }
    } catch {
      // permission errors
    }
  }

  walk(resolved);

  // Return rooms that appear more than twice
  const rooms: RoomConfig[] = [];
  const sorted = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [room, count] of sorted) {
    if (count >= 2) {
      rooms.push({
        name: room,
        description: `Files related to ${room}`,
        keywords: [room],
      });
    }
    if (rooms.length >= 6) break;
  }

  if (rooms.length === 0) {
    rooms.push({ name: 'general', description: 'All project files', keywords: [] });
  }

  return rooms;
}

/**
 * Main entry point for local room detection.
 * Tries folder structure first, falls back to filename patterns.
 *
 * Python: room_detector_local.py detect_rooms_local(project_dir, yes=False)
 */
export function detectRoomsLocal(projectDir: string): {
  rooms: RoomConfig[];
  source: string;
} {
  // Try folder structure first
  let rooms = detectRoomsFromFolders(projectDir);
  let source = 'folder structure';

  // If only "general" found, try filename patterns
  if (rooms.length <= 1) {
    rooms = detectRoomsFromFiles(projectDir);
    source = 'filename patterns';
  }

  // If still nothing, use general
  if (rooms.length === 0) {
    rooms = [{ name: 'general', description: 'All project files', keywords: [] }];
    source = 'fallback (flat project)';
  }

  return { rooms, source };
}
