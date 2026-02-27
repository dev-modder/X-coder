/**
 * Generates a random alphanumeric string of a specified length.
 * @param {number} length - The length of the string to generate (default: 4).
 * @returns {string} The generated random string.
 */
function makeid(length = 4) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let result = "";

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

module.exports = { makeid };
