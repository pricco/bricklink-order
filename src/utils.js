export const log = function (message, type) {
  console.log(`${(new Date).toISOString().replace('T', ' ')} ${type === 'error' ? '🔥' : '✅'} ${message}`);
};

export default { log };
