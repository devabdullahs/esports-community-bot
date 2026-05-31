// Discord renders <t:UNIX:style> in each viewer's local timezone automatically.
// Styles: t (short time) T (long time) d (short date) D (long date)
//         f (short date+time) F (long date+time) R (relative, e.g. "in 2h")

export function toUnix(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

export function discordTimestamp(date, style = 'f') {
  return `<t:${toUnix(date)}:${style}>`;
}

export function discordRelative(date) {
  return discordTimestamp(date, 'R');
}
