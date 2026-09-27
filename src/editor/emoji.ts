export interface EmojiEntry {
  name: string;
  glyph: string;
}

/** A curated shortcode list. The picker searches this; it is not the full gemoji database. */
export const EMOJI: EmojiEntry[] = [
  ["smile", "😄"],
  ["grin", "😁"],
  ["joy", "😂"],
  ["heart", "❤️"],
  ["fire", "🔥"],
  ["rocket", "🚀"],
  ["eyes", "👀"],
  ["tada", "🎉"],
  ["thumbsup", "👍"],
  ["+1", "👍"],
  ["white_check_mark", "✅"],
  ["warning", "⚠️"],
  ["star", "⭐"],
  ["sparkles", "✨"],
  ["wave", "👋"],
  ["clap", "👏"],
  ["ok_hand", "👌"],
  ["thinking", "🤔"],
  ["bulb", "💡"],
  ["memo", "📝"],
  ["pencil", "✏️"],
  ["book", "📖"],
  ["link", "🔗"],
  ["pushpin", "📌"],
  ["calendar", "📅"],
  ["clock", "🕒"],
  ["mag", "🔍"],
  ["lock", "🔒"],
  ["key", "🔑"],
  ["bell", "🔔"],
  ["speech_balloon", "💬"],
  ["100", "💯"],
  ["boom", "💥"],
  ["zap", "⚡"],
  ["sun", "☀️"],
  ["moon", "🌙"],
  ["cloud", "☁️"],
  ["rainbow", "🌈"],
  ["coffee", "☕"],
  ["tea", "🍵"],
  ["pizza", "🍕"],
  ["apple", "🍎"],
  ["seedling", "🌱"],
  ["rose", "🌹"],
  ["gift", "🎁"],
  ["trophy", "🏆"],
  ["check", "✔️"],
  ["x", "❌"],
  ["question", "❓"],
  ["info", "ℹ️"],
  ["computer", "💻"],
  ["keyboard", "⌨️"],
  ["file_folder", "📁"],
  ["page_facing_up", "📄"],
  ["bookmark", "🔖"],
  ["paperclip", "📎"],
  ["package", "📦"],
  ["airplane", "✈️"],
  ["house", "🏠"],
  ["globe", "🌐"],
  ["email", "✉️"],
  ["muscle", "💪"],
  ["pray", "🙏"],
  ["handshake", "🤝"],
  ["writing_hand", "✍️"],
  ["art", "🎨"],
  ["musical_note", "🎵"],
  ["soccer", "⚽"],
  ["hourglass", "⏳"],
].map(([name, glyph]) => ({ name, glyph }));

const byName = new Map(EMOJI.map((entry) => [entry.name, entry.glyph]));

export function emojiGlyph(name: string): string | null {
  return byName.get(name) ?? null;
}

export function searchEmoji(query: string, limit = 8): EmojiEntry[] {
  const needle = query.toLowerCase();
  const out: EmojiEntry[] = [];
  for (const entry of EMOJI) {
    if (!needle || entry.name.includes(needle)) out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
