const log = (msg) => {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  console.log(`[${timestamp}] ${msg}`);
};

module.exports = { log };
