// NODE's error log (B31): userData/logs/node.log, rotated at 1 MB (the
// previous file is kept as node.1.log). Lines are timestamped; page text,
// typed text and API keys are never written here.
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 1024 * 1024;

function createLog(dir) {
  const file = path.join(dir, "node.log");
  const recent = []; // last lines in memory, for diagnostics
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  function write(level, message) {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${String(message).replace(/\s+/g, " ").slice(0, 1000)}`;
    recent.push(line);
    if (recent.length > 200) recent.shift();
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, "node.1.log"));
      fs.appendFileSync(file, line + "\n");
    } catch (_) {}
  }
  return {
    info: (m) => write("info", m),
    warn: (m) => write("warn", m),
    error: (m) => write("error", m),
    recent: (n = 60) => recent.slice(-n),
    dir,
    file,
  };
}

module.exports = { createLog };
