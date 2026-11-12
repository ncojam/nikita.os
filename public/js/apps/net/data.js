/* ================= NETWORK — заготовки =================
 * Теги деятельности (подсказки; свои теги тоже можно), статусы, распознавание ссылок, цвета и кэпы стены.
 * Теги храним строчными (сервер нормализует так же: network.norm_tag).
 */
export const ACTIVITIES = [
  "digital art", "illustrator", "pixel artist", "3d artist", "animator", "2d animator", "3d animator", "concept artist",
  "character designer", "graphic designer", "ui/ux designer", "web artist", "web developer", "vibecoder", "programmer",
  "game developer", "game designer", "level designer", "indie dev", "modder", "decomp dev", "romhacker", "reverse engineer",
  "beat maker", "producer", "composer", "sound designer", "mixing engineer", "mastering engineer", "chiptune", "dj",
  "rapper", "singer", "vocalist", "songwriter", "lyricist", "guitarist", "bassist", "drummer", "pianist", "synth nerd",
  "video editor", "vfx artist", "motion designer", "filmmaker", "photographer", "streamer", "youtuber", "tiktoker",
  "writer", "poet", "comic artist", "manga artist", "tattoo artist", "graffiti writer", "street artist", "fashion designer",
  "skater", "bmx rider", "dancer", "cosplayer", "voice actor", "translator", "community manager", "publisher",
  "ad agent", "marketer", "manager", "booker", "event organizer", "label", "zine maker", "teacher", "speedrunner",
];

export const STATUSES = {
  collab: { label: "wanna collab", ru: "хочет коллаб", icon: "🤝", roles: true, rolesHint: "с кем (роли)" },
  looking: { label: "looking for", ru: "ищет людей", icon: "🔎", roles: true, rolesHint: "кого ищет (роли)" },
  creating: { label: "creating", ru: "творит", icon: "🎨" },
  busy: { label: "busy", ru: "занят", icon: "⏳" },
  with: { label: "working on a collab with", ru: "в коллабе", icon: "🔗", with: true },
  idle: { label: "don't do shit atm", ru: "ничего не делает", icon: "💤" },
};

/* ссылки: известные сайты распознаём сами — иконка и подпись; остальное подписывает пользователь */
export const LINK_KINDS = [
  ["twitter", "X / Twitter", "𝕏", /(^|\.)(twitter|x)\.com$/],
  ["telegram", "Telegram", "✈", /(^|\.)(t\.me|telegram\.me|telegram\.org)$/],
  ["instagram", "Instagram", "📸", /(^|\.)instagram\.com$/],
  ["youtube", "YouTube", "▶", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["tiktok", "TikTok", "♪", /(^|\.)tiktok\.com$/],
  ["soundcloud", "SoundCloud", "☁", /(^|\.)soundcloud\.com$/],
  ["bandcamp", "Bandcamp", "◢", /(^|\.)bandcamp\.com$/],
  ["spotify", "Spotify", "◉", /(^|\.)spotify\.com$/],
  ["applemusic", "Apple Music", "", /(^|\.)music\.apple\.com$/],
  ["yandexmusic", "Яндекс Музыка", "♫", /(^|\.)music\.yandex\.(ru|com|by|kz)$/],
  ["github", "GitHub", "⌥", /(^|\.)github\.com$/],
  ["itch", "itch.io", "🎮", /(^|\.)itch\.io$/],
  ["steam", "Steam", "♨", /(^|\.)(steampowered|steamcommunity)\.com$/],
  ["twitch", "Twitch", "◣", /(^|\.)twitch\.tv$/],
  ["discord", "Discord", "◐", /(^|\.)(discord\.gg|discord\.com)$/],
  ["vk", "VK", "В", /(^|\.)(vk\.com|vk\.ru)$/],
  ["artstation", "ArtStation", "▲", /(^|\.)artstation\.com$/],
  ["behance", "Behance", "Bē", /(^|\.)behance\.net$/],
  ["dribbble", "Dribbble", "◍", /(^|\.)dribbble\.com$/],
  ["deviantart", "DeviantArt", "✦", /(^|\.)deviantart\.com$/],
  ["pixiv", "pixiv", "P", /(^|\.)pixiv\.net$/],
  ["newgrounds", "Newgrounds", "NG", /(^|\.)newgrounds\.com$/],
  ["patreon", "Patreon", "◖", /(^|\.)patreon\.com$/],
  ["boosty", "Boosty", "B", /(^|\.)boosty\.to$/],
  ["kofi", "Ko-fi", "☕", /(^|\.)ko-fi\.com$/],
  ["bluesky", "Bluesky", "🦋", /(^|\.)bsky\.(app|social)$/],
  ["threads", "Threads", "@", /(^|\.)threads\.net$/],
  ["mastodon", "Mastodon", "🐘", /(^|\.)(mastodon\.social|mstdn\.\w+|mas\.to)$/],
  ["reddit", "Reddit", "◕", /(^|\.)reddit\.com$/],
  ["linktree", "Linktree", "🌲", /(^|\.)(linktr\.ee|taplink\.cc)$/],
  ["neocities", "Neocities", "🏠", /(^|\.)neocities\.org$/],
  ["gamejolt", "Game Jolt", "⚡", /(^|\.)gamejolt\.com$/],
  ["vimeo", "Vimeo", "▷", /(^|\.)vimeo\.com$/],
];

export function linkKind(u) {
  let host = "";
  try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  const k = LINK_KINDS.find(x => x[3].test(host));
  return k ? { k: k[0], name: k[1], icon: k[2] || "♪" } : { k: "web", name: host, icon: "🌐", unknown: true };
}

/* стена: 10 баллончиков и 3 кэпа (радиус струи в пикселях стены, сколько краски за «пшик») */
export const WALL_COLORS = ["#111114", "#f4f1ea", "#ff2e93", "#3dffc5", "#ffe03d", "#2f7bff", "#ff6a1f", "#9b4dff", "#e3242b", "#8cff3a"];
export const WALL_COLOR_NAMES = ["чёрный", "белый", "розовый", "мятный", "жёлтый", "синий", "оранжевый", "фиолетовый", "красный", "кислотный"];
export const WALL_CAPS = [
  { name: "skinny", ru: "тонкий кэп", r: 4, flow: 0.75 },
  { name: "standard", ru: "стандарт", r: 12, flow: 0.42 },
  { name: "fat", ru: "фэт-кэп", r: 30, flow: 0.36 },
];
