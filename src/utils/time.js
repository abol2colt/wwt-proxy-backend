function toMinutesBetween(start, end) {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
  );
}

function toTimeHHMM(dateValue) {
  const date = new Date(dateValue);

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

module.exports = {
  toMinutesBetween,
  toTimeHHMM,
};
