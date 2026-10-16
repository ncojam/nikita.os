const EXT = {
  audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  video: ["mp4", "webm", "mkv", "mov"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
  text: ["txt", "md", "py", "js", "json", "css", "sh", "toml", "yaml", "yml", "ini", "cfg", "log", "c", "h", "cpp", "rs", "lua", ""],
  web: ["html", "htm"],
  rom: ["gba", "gb", "gbc"],
  flash: ["swf"],
  link: ["lnk"],
  post: ["запись"],
};

const kindOf = name => {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  for (const [k, list] of Object.entries(EXT)) if (list.includes(ext)) return k;
  return "other";
};

const GLYPH = { dir: "📁", audio: "🎵", video: "🎬", image: "🖼️", text: "📄", web: "🎮", rom: "🕹️", flash: "⚡", link: "🔗", post: "📝", other: "📦" };

const KIND_NAME = { dir: "Папка", audio: "Аудио", video: "Видео", image: "Изображение", text: "Текст",
  web: "Веб-страница / игра", rom: "ROM (GBA / GB)", flash: "Flash-игра (SWF)", link: "Ярлык", post: "Запись", other: "Файл" };

export { kindOf, GLYPH, KIND_NAME };
