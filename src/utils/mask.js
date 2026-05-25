function maskValue(value) {
  if (!value) return null;

  const text = String(value);

  if (text.length <= 6) {
    return "******";
  }

  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

module.exports = {
  maskValue,
};
