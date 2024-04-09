import { parse } from "csv-parse";
import fs from "fs";
import { writeFile } from "fs/promises";

import { defaultRetainedData } from "./types/defaults";
import { evalTrapStatus } from "./functions/steamIqStatusEval";

const csvDivider = "\t"

const retainedData: RetainedData = structuredClone(defaultRetainedData);

const arrTrapInfo: TrapInfo[] = [
  {
    validFrom: 12345678,//1672441200000,
    location: "",
    application: "",
    numHoursCold: 0,
    trapName: "Test trap",
    orifDiam: 7,
    pressure: 11,
    steamEnthalpy: 2700,
    efficiency: 80,
    co2factor: 0.184,
    isModulating: false,
    siqDevId: "siqDevId",
    siqDevName: "",
    reset: false,
  },
];

const arrNewSamples: NewSample[] = [];
let newSample: NewSample;
let timestamp: Timestamp;
let result: SteamIqFuncOutput;

const pathFileToProc = process.argv[2];
const pathResultFile = process.argv[3];

fs.createReadStream(pathFileToProc)
  .pipe(parse({ delimiter: "\t", from_line: 2 }))
  .on("data", function (row) {
    try {
      timestamp = Date.parse(row[0]);
      newSample = { timestamp, cycleCounts: +row[1], activity: +row[2], temperature: 0, battery: 0 };
      arrNewSamples.push(newSample);
    } catch (err) {
      console.log(`Error occured: ${err}`);
    }
  })
  .on("end", async function () {

    result = evalTrapStatus(arrNewSamples, arrTrapInfo, retainedData);

    console.log(result.arrSamplesForStoring.at(-1));

    let forCsv = "dateTimeUtc\tact\tcyCts\ttemp\tbat\tstatus\ttotKg\ttotKwh\ttotCo2\tmeLeak\textNF\ttrapIdx\tstype\n"
    for (let sample of result.arrSamplesForStoring) {
        forCsv +=
        (new Date(sample.ts)).toISOString() +
        csvDivider +
        sample.activity +
        csvDivider +
        sample.cycleCounts +
        csvDivider +
        sample.temperature +
        csvDivider +
        sample.battery +
        csvDivider +
        sample.status +
        csvDivider +
        sample.totalLossesKg +
        csvDivider +
        sample.totalLossesKwh +
        csvDivider +
        sample.totalLossesCo2 +
        csvDivider +
        sample.meanIntLeak * 1 +
        csvDivider +
        sample.extNoiseFactor +
        csvDivider +
        sample.trapIndex +
        csvDivider +
        sample.stype +
        "\n";
    }
    await writeFile(
        pathResultFile,
        forCsv,
        {
          encoding: "utf8",
          flag: "w",
        }
      );
  })
  .on("error", function (error) {
    console.log(error.message);
  });
