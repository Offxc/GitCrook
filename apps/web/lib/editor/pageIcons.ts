import { ICON_PATHS } from "./iconPaths.generated";

/**
 * The full flat icon set available as page/group/section icons — every
 * non-brand icon Phosphor ships, one consistent outline style.
 *
 * `slug` is what's stored on Page.icon; paths are looked up from it at
 * render time (see PageIcon.tsx), so this list can grow or be reordered
 * without touching saved data.
 *
 * Labels are derived from the slug, which is enough for search on its own
 * since Phosphor's names are descriptive ("magnifying-glass", "file-text").
 * SYNONYMS only adds the words someone would plausibly type that *aren't*
 * in the name — "settings" for a gear, "faq" for a question mark.
 */
export interface PageIconEntry {
  slug: string;
  label: string;
  paths: string[];
  keywords: string[];
}

const SYNONYMS: Record<string, string[]> = {
  "gear-six": ["settings", "config", "configuration", "preferences"],
  gear: ["settings", "config", "preferences"],
  "sliders-horizontal": ["settings", "filters", "adjust"],
  faders: ["settings", "filters", "tune"],
  "magnifying-glass": ["search", "find", "lookup"],
  question: ["faq", "help", "support"],
  info: ["about", "note", "details"],
  lightbulb: ["idea", "tip", "hint"],
  rocket: ["launch", "quickstart", "getting started"],
  "flag-checkered": ["start", "finish", "goal"],
  compass: ["navigate", "guide", "overview"],
  "map-trifold": ["roadmap", "overview"],
  "book-open": ["docs", "guide", "read", "documentation"],
  book: ["docs", "reference", "documentation"],
  "file-text": ["document", "page", "notes"],
  "note-pencil": ["write", "edit", "compose"],
  "graduation-cap": ["learn", "tutorial", "training", "education"],
  "lock-key": ["security", "private", "auth", "locked"],
  "lock-open": ["public", "open", "unlocked"],
  key: ["auth", "api key", "access", "credentials"],
  shield: ["security", "protection"],
  "shield-check": ["verified", "protected", "safe"],
  "shield-warning": ["risk", "moderation"],
  "seal-check": ["verified", "approved", "official"],
  fingerprint: ["identity", "biometric", "auth"],
  bug: ["debug", "issue", "defect"],
  "test-tube": ["test", "experiment", "beta", "qa"],
  "puzzle-piece": ["integration", "plugin", "extension", "addon"],
  package: ["install", "release", "module", "dependency"],
  wrench: ["tools", "fix", "maintenance"],
  toolbox: ["tools", "setup", "build"],
  "hard-hat": ["construction", "wip", "in progress"],
  code: ["dev", "snippet", "programming"],
  terminal: ["cli", "shell", "console", "command"],
  "terminal-window": ["cli", "shell", "console"],
  database: ["sql", "storage", "data"],
  "floppy-disk": ["save", "backup", "storage"],
  cloud: ["hosting", "infra", "server"],
  globe: ["web", "internet", "domain", "network"],
  link: ["url", "hyperlink", "reference"],
  "arrow-square-out": ["external", "outbound", "leave"],
  broadcast: ["api", "webhook", "signal", "live"],
  "chart-bar": ["analytics", "stats", "metrics"],
  "chart-line": ["analytics", "growth", "trend", "metrics"],
  "chart-pie-slice": ["analytics", "breakdown"],
  kanban: ["board", "workflow", "project"],
  table: ["grid", "spreadsheet", "data"],
  "squares-four": ["dashboard", "apps", "overview", "grid"],
  money: ["billing", "payment", "pricing"],
  coins: ["currency", "economy", "payment"],
  "credit-card": ["payment", "billing", "checkout"],
  receipt: ["invoice", "billing", "order"],
  storefront: ["shop", "store", "market"],
  trophy: ["rank", "achievement", "leaderboard", "winner"],
  crown: ["premium", "vip", "admin", "owner"],
  star: ["favorite", "rating", "featured"],
  users: ["team", "members", "staff", "people"],
  user: ["account", "profile", "person"],
  "user-circle": ["account", "profile", "avatar"],
  "hand-waving": ["hello", "welcome", "intro", "greeting"],
  handshake: ["deal", "partnership", "agreement"],
  bell: ["notification", "alert", "reminder"],
  "chat-circle": ["comment", "message", "support", "discord"],
  megaphone: ["announcement", "broadcast", "news"],
  "envelope-simple": ["email", "mail", "contact"],
  siren: ["alert", "emergency", "incident", "moderation"],
  detective: ["moderation", "investigation", "anti-cheat"],
  scales: ["rules", "policy", "law", "justice"],
  hammer: ["ban", "punishment", "moderation", "build"],
  prohibit: ["no", "forbidden", "banned", "blocked"],
  warning: ["caution", "alert"],
  "warning-octagon": ["danger", "critical", "stop"],
  "check-circle": ["done", "complete", "success", "ok"],
  "list-checks": ["todo", "steps", "tasks", "checklist"],
  "clock-counter-clockwise": ["history", "revert", "changelog", "undo"],
  "arrows-clockwise": ["sync", "refresh", "reload", "update"],
  hourglass: ["waiting", "pending", "loading"],
  "calendar-blank": ["date", "schedule", "changelog"],
  palette: ["design", "theme", "style", "branding"],
  "paint-brush": ["design", "art", "customise"],
  image: ["media", "photo", "picture"],
  video: ["media", "clip", "recording"],
  "monitor-play": ["watch", "stream", "tutorial"],
  lightning: ["fast", "power", "performance", "quick"],
  sparkle: ["new", "feature", "highlight"],
  fire: ["hot", "urgent", "trending", "popular"],
  house: ["home", "start", "index"],
  buildings: ["company", "organization", "office"],
  plug: ["connect", "integration"],
  cpu: ["hardware", "processor", "performance"],
  "hard-drives": ["storage", "disk", "server"],
  "git-branch": ["git", "version control", "repo", "branch"],
  "device-mobile": ["mobile", "phone", "app"],
  keyboard: ["shortcuts", "hotkeys", "input"],
  eye: ["view", "visible", "preview", "watch"],
  "eye-slash": ["hidden", "private", "invisible"],
};

function labelFor(slug: string): string {
  const words = slug.split("-");
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export const PAGE_ICONS: PageIconEntry[] = Object.entries(ICON_PATHS).map(([slug, paths]) => ({
  slug,
  label: labelFor(slug),
  paths,
  keywords: SYNONYMS[slug] ?? [],
}));

const BY_SLUG = new Map(PAGE_ICONS.map((entry) => [entry.slug, entry] as const));

export function findPageIcon(slug: string | null | undefined): PageIconEntry | undefined {
  if (!slug) return undefined;
  return BY_SLUG.get(slug);
}

export function searchPageIcons(query: string): PageIconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return PAGE_ICONS;
  // Name matches rank above synonym-only matches, and a prefix match above a
  // mid-word one — searching "book" should lead with "book", not "notebook".
  const scored: { entry: PageIconEntry; score: number }[] = [];
  for (const entry of PAGE_ICONS) {
    let score = -1;
    if (entry.slug === q) score = 0;
    else if (entry.slug.startsWith(q)) score = 1;
    else if (entry.slug.includes(q)) score = 2;
    else if (entry.keywords.some((k) => k.startsWith(q))) score = 3;
    else if (entry.keywords.some((k) => k.includes(q))) score = 4;
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.slug.length - b.entry.slug.length);
  return scored.map((s) => s.entry);
}
