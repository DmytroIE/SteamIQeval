import fs from "fs";

function logToFile(message: string) {
  const logStream = fs.createWriteStream("../logs/log.txt", { flags: "a" });
  logStream.write(`${message}\n`);
  logStream.end();
  console.log(message);
}
const logger = {
  info: (message: string) => logToFile(`[INFO]\t${new Date(Date.now()).toISOString()}\t${message}`),
  warn: (message: string) => logToFile(`[WARN]\t${new Date(Date.now()).toISOString()}\t${message}`),
  error: (message: string) => logToFile(`[ERROR]\t${new Date(Date.now()).toISOString()}\t${message}`),
};
export { logger };
