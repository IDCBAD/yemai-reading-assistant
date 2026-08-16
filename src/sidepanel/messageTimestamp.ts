function pad(value: number) {
  return String(value).padStart(2, '0');
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function timeOfDay(value: Date) {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function formatMessageTimestamp(timestamp: number, now = Date.now()) {
  const value = new Date(timestamp);
  const current = new Date(now);
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const time = timeOfDay(value);

  const label = sameDay(value, current)
    ? time
    : sameDay(value, yesterday)
      ? `昨天 ${time}`
      : value.getFullYear() === current.getFullYear()
        ? `${value.getMonth() + 1}月${value.getDate()}日 ${time}`
        : `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日 ${time}`;

  return {
    label,
    fullLabel: `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日 ${time}:${pad(value.getSeconds())}`,
    dateTime: value.toISOString(),
  };
}
