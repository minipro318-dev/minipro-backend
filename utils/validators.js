const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isStrongPassword = (value) => {
  if (typeof value !== "string" || value.length < 8) {
    return false;
  }
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
};

module.exports = { isEmail, isStrongPassword };
