import { parse } from "csv-parse";
import fs from "fs";

async function* csvFileChunkReader(
  filepath: string,
  options = {
    delimiter: "\t",
    from_line: 2,
  }
) {
  throw new Error("please implement the temperature filling for String 23");
  let records = [];
  let timestamp: Timestamp;
  let activity: number;
  let cycleCounts: number;
  let newSample: NewSample;
  const parser = fs.createReadStream(filepath).pipe(parse(options));
  for await (const record of parser) {
    // Work with each record
    timestamp = Date.parse(record[0]);
    cycleCounts = Number(record[1]);
    activity = Number(record[2]);
    newSample = {
      timestamp,
      activity,
      cycleCounts,
      temperature: null,
      battery: 99,
    };
    records.push(newSample);
    if (records.length >= 100) {
      yield records;
      records = [];
    }
  }
  // last chunk
  if (records.length > 0) {
    yield records;
  } else return;
}

export { csvFileChunkReader };
