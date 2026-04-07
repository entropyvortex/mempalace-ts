/**
 * Deterministic data factory for MemPalace scale benchmarks.
 *
 * Generates realistic project files, conversations, and KG triples at
 * configurable scale levels. All randomness uses seeded RNG for reproducibility.
 *
 * Planted "needle" drawers enable recall measurement without an LLM judge.
 *
 * Port of Python data_generator.py
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Scale configurations ─────────────────────────────────────────────────

export const SCALE_CONFIGS: Record<
  string,
  {
    drawers: number;
    wings: number;
    rooms_per_wing: number;
    kg_entities: number;
    kg_triples: number;
    needles: number;
    search_queries: number;
  }
> = {
  small: {
    drawers: 1_000,
    wings: 3,
    rooms_per_wing: 5,
    kg_entities: 50,
    kg_triples: 200,
    needles: 20,
    search_queries: 20,
  },
  medium: {
    drawers: 10_000,
    wings: 8,
    rooms_per_wing: 12,
    kg_entities: 200,
    kg_triples: 2_000,
    needles: 50,
    search_queries: 50,
  },
  large: {
    drawers: 50_000,
    wings: 15,
    rooms_per_wing: 20,
    kg_entities: 500,
    kg_triples: 10_000,
    needles: 100,
    search_queries: 100,
  },
  stress: {
    drawers: 100_000,
    wings: 25,
    rooms_per_wing: 30,
    kg_entities: 1_000,
    kg_triples: 50_000,
    needles: 200,
    search_queries: 200,
  },
};

// ── Vocabulary banks for realistic content ───────────────────────────────

export const WING_NAMES = [
  'webapp',
  'backend_api',
  'mobile_app',
  'data_pipeline',
  'ml_platform',
  'devops',
  'auth_service',
  'payments',
  'analytics',
  'docs_site',
  'cli_tool',
  'dashboard',
  'notification_service',
  'search_engine',
  'user_mgmt',
  'inventory',
  'reporting',
  'testing_infra',
  'monitoring',
  'email_service',
  'chat_bot',
  'file_storage',
  'scheduler',
  'gateway',
  'marketplace',
];

export const ROOM_NAMES = [
  'backend',
  'frontend',
  'api',
  'database',
  'auth',
  'tests',
  'docs',
  'config',
  'deployment',
  'models',
  'views',
  'controllers',
  'middleware',
  'utils',
  'schemas',
  'migrations',
  'fixtures',
  'scripts',
  'styles',
  'components',
  'hooks',
  'services',
  'routes',
  'templates',
  'static',
  'media',
  'logging',
  'cache',
  'queue',
  'workers',
];

export const TECH_TERMS = [
  'authentication',
  'authorization',
  'middleware',
  'endpoint',
  'REST API',
  'GraphQL',
  'WebSocket',
  'database migration',
  'ORM',
  'query optimization',
  'caching strategy',
  'load balancer',
  'rate limiting',
  'pagination',
  'serialization',
  'validation',
  'error handling',
  'logging framework',
  'monitoring',
  'deployment pipeline',
  'CI/CD',
  'containerization',
  'microservice',
  'event sourcing',
  'message queue',
  'pub/sub',
  'connection pooling',
  'session management',
  'token refresh',
  'CORS',
  'SSL termination',
  'health check',
  'circuit breaker',
  'retry logic',
  'batch processing',
  'stream processing',
  'data pipeline',
  'ETL',
  'feature flag',
  'A/B testing',
  'blue-green deployment',
  'canary release',
];

export const CODE_SNIPPETS = [
  'def process_request(data):\n    validated = schema.validate(data)\n    result = handler.execute(validated)\n    return Response(result, status=200)\n',
  'class UserRepository:\n    def __init__(self, db):\n        self.db = db\n    def find_by_id(self, user_id):\n        return self.db.query(User).filter(User.id == user_id).first()\n',
  'async def fetch_data(url, timeout=30):\n    async with aiohttp.ClientSession() as session:\n        async with session.get(url, timeout=timeout) as resp:\n            return await resp.json()\n',
  'const handleSubmit = async (formData) => {\n  try {\n    const response = await api.post(\'/users\', formData);\n    dispatch({ type: \'USER_CREATED\', payload: response.data });\n  } catch (error) {\n    setError(error.message);\n  }\n};\n',
  "SELECT u.name, COUNT(o.id) as order_count\nFROM users u\nLEFT JOIN orders o ON u.id = o.user_id\nWHERE u.created_at > '2025-01-01'\nGROUP BY u.name\nHAVING COUNT(o.id) > 5\nORDER BY order_count DESC;\n",
];

export const PROSE_TEMPLATES = [
  'The {component} module handles {task}. It was refactored in {month} to improve {quality}. Key design decision: {decision}.',
  'Bug report: {component} fails when {condition}. Root cause: {cause}. Fixed by {fix}. Regression test added in {test_file}.',
  'Architecture decision: switched from {old_tech} to {new_tech} for {reason}. Migration completed {date}. Performance improved by {percent}%.',
  'Meeting notes: discussed {topic} with {person}. Agreed to {action}. Deadline: {deadline}. Follow-up: {followup}.',
  'Feature spec: {feature_name} allows users to {capability}. Dependencies: {deps}. Estimated effort: {effort} days.',
];

export const ENTITY_NAMES = [
  'Alice',
  'Bob',
  'Carol',
  'Dave',
  'Eve',
  'Frank',
  'Grace',
  'Heidi',
  'Ivan',
  'Judy',
  'Karl',
  'Linda',
  'Mike',
  'Nina',
  'Oscar',
  'Pat',
  'Quinn',
  'Rita',
  'Steve',
  'Tina',
  'Ursula',
  'Victor',
  'Wendy',
  'Xander',
];

export const ENTITY_TYPES = ['person', 'project', 'tool', 'concept', 'team', 'service'];

export const PREDICATES = [
  'works_on',
  'manages',
  'reports_to',
  'collaborates_with',
  'created',
  'maintains',
  'uses',
  'depends_on',
  'replaced',
  'reviewed',
  'deployed',
  'tested',
  'documented',
  'mentors',
  'leads',
  'contributes_to',
];

// ── Seeded PRNG (mulberry32) ─────────────────────────────────────────────

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Mulberry32: returns float in [0, 1) */
  next(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  choice<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  randint(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  random(): number {
    return this.next();
  }

  /** Fisher-Yates sample (returns n items without replacement) */
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = arr.slice();
    const result: T[] = [];
    const len = Math.min(n, copy.length);
    for (let i = 0; i < len; i++) {
      const j = i + Math.floor(this.next() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
      result.push(copy[i]);
    }
    return result;
  }

  /** In-place Fisher-Yates shuffle */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// ── Needle topics for recall measurement ─────────────────────────────────

const NEEDLE_TOPICS = [
  'Fibonacci sequence optimization uses memoization with O(n) space complexity',
  'PostgreSQL vacuum autovacuum threshold set to 50 percent for table users',
  'Redis cluster failover timeout configured at 30 seconds with sentinel monitoring',
  'Kubernetes horizontal pod autoscaler targets 70 percent CPU utilization',
  'GraphQL subscription uses WebSocket transport with heartbeat interval 25 seconds',
  'JWT token rotation policy requires refresh every 15 minutes with sliding window',
  'Elasticsearch index sharding strategy uses 5 primary shards with 1 replica each',
  'Docker multi-stage build reduces image size from 1.2GB to 180MB for production',
  'Apache Kafka consumer group rebalance timeout set to 45 seconds',
  'MongoDB change streams resume token persisted every 100 operations',
  'gRPC streaming uses bidirectional flow control with 64KB window size',
  'Prometheus alerting rule fires when p99 latency exceeds 500ms for 5 minutes',
  'Terraform state locking uses DynamoDB with consistent reads enabled',
  'Nginx rate limiting configured at 100 requests per second with burst of 50',
  'SQLAlchemy connection pool size set to 20 with max overflow of 10 connections',
  'React concurrent mode uses startTransition for non-urgent state updates',
  'AWS Lambda cold start mitigation uses provisioned concurrency of 10 instances',
  'Git bisect automated with custom test script for regression hunting',
  'OpenTelemetry trace sampling rate set to 10 percent in production environment',
  'Celery worker prefetch multiplier set to 1 for fair task distribution',
];

// ── Types ────────────────────────────────────────────────────────────────

export interface NeedleInfo {
  id: string;
  content: string;
  wing: string;
  room: string;
  query: string;
}

export interface KgTripleData {
  entities: Array<[string, string]>; // [name, type]
  triples: Array<[string, string, string, string, string | null]>; // [subject, predicate, object, valid_from, valid_to]
}

export interface SearchQuery {
  query: string;
  expected_wing: string | null;
  expected_room: string | null;
  needle_id: string | null;
  is_needle: boolean;
}

// ── PalaceDataGenerator ──────────────────────────────────────────────────

export class PalaceDataGenerator {
  rng: SeededRandom;
  scale: string;
  cfg: (typeof SCALE_CONFIGS)[string];
  wings: string[];
  roomsByWing: Record<string, string[]>;
  needles: NeedleInfo[];

  constructor(seed = 42, scale = 'small') {
    this.rng = new SeededRandom(seed);
    this.scale = scale;
    this.cfg = SCALE_CONFIGS[scale];
    this.wings = WING_NAMES.slice(0, this.cfg.wings);
    this.roomsByWing = {};
    for (const wing of this.wings) {
      const n = this.cfg.rooms_per_wing;
      this.roomsByWing[wing] = this.rng.sample(ROOM_NAMES, Math.min(n, ROOM_NAMES.length));
    }
    this.needles = [];
    this._generateNeedles();
  }

  private _generateNeedles(): void {
    for (let i = 0; i < this.cfg.needles; i++) {
      const topic = NEEDLE_TOPICS[i % NEEDLE_TOPICS.length];
      const wing = this.rng.choice(this.wings);
      const room = this.rng.choice(this.roomsByWing[wing]);
      const needleId = `NEEDLE_${String(i).padStart(4, '0')}`;
      const content = `${needleId}: ${topic}. This is a unique planted needle for recall benchmarking at scale.`;

      let query: string;
      if (topic.includes(' uses ')) {
        query = topic.split(' uses ')[0];
      } else if (topic.includes(' set to ')) {
        query = topic.split(' set to ')[0];
      } else {
        query = topic.slice(0, 60);
      }

      this.needles.push({ id: needleId, content, wing, room, query });
    }
  }

  /** Generate a random text block of realistic content. */
  randomText(minChars = 600, maxChars = 900): string {
    const parts: string[] = [];
    let total = 0;
    const target = this.rng.randint(minChars, maxChars);

    while (total < target) {
      const choice = this.rng.random();
      let text: string;
      if (choice < 0.3) {
        text = this.rng.choice(CODE_SNIPPETS);
      } else if (choice < 0.7) {
        const template = this.rng.choice(PROSE_TEMPLATES);
        text = template
          .replace('{component}', this.rng.choice(ROOM_NAMES))
          .replace('{task}', this.rng.choice(TECH_TERMS))
          .replace('{month}', this.rng.choice(['January', 'February', 'March', 'April', 'May']))
          .replace('{quality}', this.rng.choice(['performance', 'readability', 'test coverage', 'latency']))
          .replace('{decision}', this.rng.choice(TECH_TERMS))
          .replace('{condition}', this.rng.choice(TECH_TERMS) + ' is null')
          .replace('{cause}', this.rng.choice(['race condition', 'null pointer', 'timeout', 'OOM']))
          .replace('{fix}', 'adding ' + this.rng.choice(TECH_TERMS))
          .replace('{test_file}', `test_${this.rng.choice(ROOM_NAMES)}.py`)
          .replace('{old_tech}', this.rng.choice(['MySQL', 'Flask', 'REST', 'Jenkins']))
          .replace('{new_tech}', this.rng.choice(['PostgreSQL', 'FastAPI', 'GraphQL', 'GitHub Actions']))
          .replace('{reason}', this.rng.choice(TECH_TERMS))
          .replace('{date}', `2025-${String(this.rng.randint(1, 12)).padStart(2, '0')}-${String(this.rng.randint(1, 28)).padStart(2, '0')}`)
          .replace('{percent}', String(this.rng.randint(10, 80)))
          .replace('{topic}', this.rng.choice(TECH_TERMS))
          .replace('{person}', this.rng.choice(ENTITY_NAMES))
          .replace('{action}', this.rng.choice(['refactor', 'migrate', 'optimize', 'test']))
          .replace('{deadline}', `2025-${String(this.rng.randint(1, 12)).padStart(2, '0')}-${String(this.rng.randint(1, 28)).padStart(2, '0')}`)
          .replace('{followup}', this.rng.choice(TECH_TERMS))
          .replace('{feature_name}', this.rng.choice(TECH_TERMS))
          .replace('{capability}', this.rng.choice(TECH_TERMS))
          .replace('{deps}', this.rng.sample(TECH_TERMS, 2).join(', '))
          .replace('{effort}', String(this.rng.randint(1, 15)));
      } else {
        const words = this.rng.sample(TECH_TERMS, Math.min(5, TECH_TERMS.length));
        text = words.join(' ') + '. ' + this.rng.choice(TECH_TERMS) + ' implementation details follow.\n';
      }
      parts.push(text);
      total += text.length;
    }
    return parts.join('\n').slice(0, maxChars);
  }

  // ── Project tree generation (for mine() tests) ─────────────────────────

  generateProjectTree(
    basePath: string,
    options?: { wing?: string; rooms?: string[]; nFiles?: number },
  ): { projectPath: string; wing: string; rooms: string[]; filesWritten: number } {
    const nFiles = options?.nFiles ?? 50;
    const wing = options?.wing ?? this.rng.choice(this.wings);
    const rooms = options?.rooms ?? this.roomsByWing[wing] ?? ['general'];

    mkdirSync(basePath, { recursive: true });

    // Write mempalace.yaml
    const roomDefs = rooms.map((r) => `  - name: ${r}\n    description: "${r} code and docs"`);
    const yaml = `wing: ${wing}\nrooms:\n${roomDefs.join('\n')}\n`;
    writeFileSync(join(basePath, 'mempalace.yaml'), yaml, 'utf-8');

    // Write files distributed across room directories
    let filesWritten = 0;
    for (let i = 0; i < nFiles; i++) {
      const room = rooms[i % rooms.length];
      const roomDir = join(basePath, room);
      mkdirSync(roomDir, { recursive: true });

      const ext = this.rng.choice(['.py', '.js', '.md', '.ts', '.yaml']);
      const filename = `file_${String(i).padStart(4, '0')}${ext}`;
      const content = this.randomText(400, 2000);
      writeFileSync(join(roomDir, filename), content, 'utf-8');
      filesWritten++;
    }

    return { projectPath: basePath, wing, rooms, filesWritten };
  }

  // ── Conversation file generation (for mine_convos() tests) ─────────────

  generateConversationFiles(
    basePath: string,
    options?: { wing?: string; nFiles?: number },
  ): { convoPath: string; wing: string } {
    const nFiles = options?.nFiles ?? 20;
    const wing = options?.wing ?? this.rng.choice(this.wings);

    mkdirSync(basePath, { recursive: true });

    for (let i = 0; i < nFiles; i++) {
      const lines: string[] = [];
      const nExchanges = this.rng.randint(5, 20);
      for (let j = 0; j < nExchanges; j++) {
        const userMsg = `> User: ${this.rng.choice(TECH_TERMS)}? How does ${this.rng.choice(TECH_TERMS)} work with ${this.rng.choice(TECH_TERMS)}?`;
        const aiMsg = this.randomText(200, 600);
        lines.push(userMsg);
        lines.push(aiMsg);
        lines.push('');
      }
      writeFileSync(join(basePath, `convo_${String(i).padStart(4, '0')}.txt`), lines.join('\n'), 'utf-8');
    }

    return { convoPath: basePath, wing };
  }

  // ── KG triple generation ───────────────────────────────────────────────

  generateKgTriples(nEntities?: number, nTriples?: number): KgTripleData {
    const numEntities = nEntities ?? this.cfg.kg_entities;
    const numTriples = nTriples ?? this.cfg.kg_triples;

    // Generate entities
    const entities: Array<[string, string]> = [];
    const entityNames: string[] = [];
    for (let i = 0; i < numEntities; i++) {
      const name = i < ENTITY_NAMES.length ? ENTITY_NAMES[i] : `Entity_${String(i).padStart(4, '0')}`;
      const etype = this.rng.choice(ENTITY_TYPES);
      entities.push([name, etype]);
      entityNames.push(name);
    }

    // Generate triples
    const triples: Array<[string, string, string, string, string | null]> = [];
    const baseDate = new Date('2024-01-01');
    for (let i = 0; i < numTriples; i++) {
      const subject = this.rng.choice(entityNames);
      let obj = this.rng.choice(entityNames);
      while (obj === subject) {
        obj = this.rng.choice(entityNames);
      }
      const predicate = this.rng.choice(PREDICATES);
      const daysOffset = this.rng.randint(0, 730);
      const validFromDate = new Date(baseDate.getTime() + daysOffset * 86400000);
      const validFrom = validFromDate.toISOString().split('T')[0];

      let validTo: string | null = null;
      if (this.rng.random() < 0.3) {
        const endOffset = this.rng.randint(30, 365);
        const validToDate = new Date(validFromDate.getTime() + endOffset * 86400000);
        validTo = validToDate.toISOString().split('T')[0];
      }
      triples.push([subject, predicate, obj, validFrom, validTo]);
    }

    return { entities, triples };
  }

  // ── Search query generation ────────────────────────────────────────────

  generateSearchQueries(nQueries?: number): SearchQuery[] {
    const numQueries = nQueries ?? this.cfg.search_queries;
    const queries: SearchQuery[] = [];

    // Half are needle queries (known-good answers)
    const nNeedle = Math.min(Math.floor(numQueries / 2), this.needles.length);
    for (const needle of this.needles.slice(0, nNeedle)) {
      queries.push({
        query: needle.query,
        expected_wing: needle.wing,
        expected_room: needle.room,
        needle_id: needle.id,
        is_needle: true,
      });
    }

    // Other half are generic queries (measure latency, not recall)
    const nGeneric = numQueries - nNeedle;
    for (let i = 0; i < nGeneric; i++) {
      queries.push({
        query: this.rng.choice(TECH_TERMS) + ' ' + this.rng.choice(TECH_TERMS),
        expected_wing: null,
        expected_room: null,
        needle_id: null,
        is_needle: false,
      });
    }

    this.rng.shuffle(queries);
    return queries;
  }
}
