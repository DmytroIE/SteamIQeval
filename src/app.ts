require("dotenv").config({ path: "../.env" });

import { readFile, writeFile } from "fs/promises";
import { Client, Message } from "azure-iot-device";

import { evalTrapStatus } from "./functions/steamIqStatusEval";
import { steamIqChunkDataFetcher } from "./services/steamIqApiServices";
import { logger } from "./services/logger";
import { checkArrayIsNotEmpty } from "./helpers/helpers";
import { csvFileChunkReader } from "./services/csvFileServices";
import { prepTrapDataForStoring } from "./helpers/prepareDataForStoring";

import { defaultRetainedData } from "./types/defaults";
import { createIotHubMqttClient } from "./services/azureDataEmitServices";

const IOT_HUB_SEND_PAUSE_MS = 15000;

const main = async (): Promise<void> => {
  let client: Client | undefined = undefined;
  try {
    logger.info("Start-----------------------------------------");

    // load info about the traps
    const confObjString = await readFile("../config/config.json", {
      encoding: "utf8",
    });

    if (confObjString.length < 2) {
      throw new Error(`The initial settings cannot be taken from the string`);
    }
    const confObj = JSON.parse(confObjString);

    let trapId: string;
    let trap: any;
    let connStr: string = "";
    let connStrPrev: string = "";

    for ([trapId, trap] of Object.entries(confObj)) {
      logger.info(`Processing data for trap ${trapId}`);
      try {
        // check the conf
        if (
          !trap.pathToInfoFile ||
          !trap.pathToRetDataFile ||
          !trap.pathToProcDataFile ||
          !trap.iotHubConStrRef
        ) {
          throw new Error(`No config data for Trap ${trapId}`);
        }

        // create an IoTHub client for this trap
        connStr = process.env[trap.iotHubConStrRef] || "";
        if (connStr === "") {
          throw new Error(`No connection string for Trap ${trapId}`);
        }
        if (connStr === connStrPrev && client) {
          connStrPrev = connStr; // we can use the client from the previous iteration
        } else {
          if (client) {
            client.close(() => {
              logger.info("IoT Hub client disconnected");
            });
          }
          logger.info("Create a new IoT Hub client");
          client = createIotHubMqttClient(connStr);
          logger.info("Trying to connect IoT Hub client to the hub");
          await client.open();
          connStrPrev = connStr; //if we managed to get to this point without an exception then the client got connected
        }

        /*const temp = `[
          {
                  "time": 1709038800,
                  "VT3609act": 18,
                  "VT3609cc": 3,
                  "VT3609temp": 29,
                  "VT3609bat": 99,
                  "VT3609st": 3,
                  "VT3609totkg": 19773.6,
                  "VT3609enf": 45.1
          },
          {
                  "time": 1709042400,
                  "VT3609act": 41,
                  "VT3609cc": 16,
                  "VT3609temp": 31,
                  "VT3609bat": 99,
                  "VT3609st": 3,
                  "VT3609totkg": 19773.6,
                  "VT3609enf": 75.3
          }
        ]`;
        const message = new Message(temp);
        console.log(
          `Sending the fake message for ${trapId} to the hub`
        );
        await client.sendEvent(message);*/

        // load trap info list
        const arrTrapInfoString = await readFile(trap.pathToInfoFile, {
          encoding: "utf8",
        });
        if (arrTrapInfoString.length < 2) {
          throw Error(`No info for Trap ${trap.trapId}`);
        }
        const arrTrapInfo: TrapInfo[] = JSON.parse(arrTrapInfoString);
        for (let item of arrTrapInfo) {
          // convert ISO datetime string to a timestamp if neccessary
          if (typeof item.validFrom === "string") {
            item.validFrom = Date.parse(item.validFrom);
          }
        }
        if (!checkArrayIsNotEmpty(arrTrapInfo)) {
          throw new Error(`The info for Trap ${trap.trapId} is corrupted`);
        }
        arrTrapInfo.sort((a, b) => a.validFrom - b.validFrom); // sort the array just in case

        // load retained data object
        const retainedDataString = await readFile(trap.pathToRetDataFile, {
          encoding: "utf8",
        });
        let retainedData: RetainedData;
        let newRetainedData: RetainedData;
        let arrSamplesForStoring: SampleForStoringInDb[];
        // preparing initial start timestamp
        let startTs: Timestamp;
        if (retainedDataString.length < 2) {
          // if the file doesn't exist or empty
          retainedData = structuredClone(defaultRetainedData);
          console.log(`Init with default data`);

          startTs = arrTrapInfo[0].validFrom;
        } else {
          retainedData = JSON.parse(retainedDataString);
          console.log(`Data is taken from the file`);

          if (
            !retainedData ||
            !retainedData.arrLastSamples ||
            !checkArrayIsNotEmpty(retainedData.arrLastSamples)
          ) {
            throw `Retained data for trap ${trapId} is corrupted`;
          }
          startTs =
            retainedData.arrLastSamples[retainedData.arrLastSamples.length - 1]
              .timestamp + 1; // 1 is a margin
        }

        let endTs: Timestamp;
        let siqDevId: string;
        let numberOfProcessedChunks = 0;
        let i = 0;
        while (i < arrTrapInfo.length) {
          if (startTs >= arrTrapInfo[i].validFrom) {
            endTs = Date.now();
            siqDevId = arrTrapInfo[i].siqDevId;
            let j = i + 1;
            while (j < arrTrapInfo.length) {
              if (arrTrapInfo[i].siqDevId === arrTrapInfo[j].siqDevId) {
                // find infos with the same siqDevId
                j += 1;
                continue;
              } else {
                endTs = arrTrapInfo[j].validFrom - 1;
                break;
              }
            }

            const reader = steamIqChunkDataFetcher(
              siqDevId,
              startTs,
              endTs,
              100
            );
            //csvFileChunkReader("../POL-16.csv"); // test with the file instead of real api

            for await (const arrNewSamples of reader) {
              ({ arrSamplesForStoring, newRetainedData } = evalTrapStatus(
                arrNewSamples,
                arrTrapInfo,
                retainedData
              ));
              retainedData = newRetainedData;
              numberOfProcessedChunks++;
              const { forCsv, forIot } = prepTrapDataForStoring(
                arrSamplesForStoring,
                trapId
              );
              await writeFile(trap.pathToProcDataFile, forCsv, {
                encoding: "utf8",
                flag: "a",
              });

              // remove it later
              console.log(
                `\n----------------------------\nEmulate sending Message ${numberOfProcessedChunks} to the hub`
              );
              console.log(forIot.slice(0, 180) + "...");

              const message = new Message(forIot);
              console.log(
                `Sending the message ${numberOfProcessedChunks} to the hub`
              );
              await client.sendEvent(message);

              await new Promise((resolve, reject) =>
                setTimeout(resolve, IOT_HUB_SEND_PAUSE_MS)
              );
            }
            i += j;
          } else {
            i += 1;
          }
        }
        if (numberOfProcessedChunks > 0) {
          await writeFile(
            trap.pathToRetDataFile,
            JSON.stringify(retainedData, null, "\t"),
            { encoding: "utf8", flag: "w" }
          );
          logger.info(`Data for Trap ${trapId} was succesfuly processed`);
        } else {
          logger.info(`No data for Trap ${trapId} was processed`);
        }
      } catch (err) {
        logger.error(`Error while processing Trap ${trapId}: ${err as string}`);
        continue;
      }
    }
  } catch (err) {
    logger.error(`The program was not executed. ${err as string}`);
  } finally {
    if (client) {
      client.close(() => {
        logger.info("IoT Hub Client disconnected");
      });
    }
  }
};

main();

//test code to test the eval function
/*
const retainedData: RetainedData = {
  floodFactor: 0,
  prevStatus: Status.Undefined,
  totalLossesKg: 0,
  totalLossesKwh: 0,
  totalLossesCo2: 0,
  hoursOfLeaking: 0,
  prevTrapIndex: null,
  arrActSamples: [],
  arrLastSamples: [],
};

const arrTrapInfo: TrapInfo[] = [
  {
    validFrom: 12345678,//1672441200000,
    trapName: "POL-16",
    orifDiam: 7,
    pressure: 11,
    steamEnthalpy: 2700,
    efficiency: 80,
    co2factor: 0.184,
    isModulating: false,
    siqDevId: "siqDevId",
    reset: false,
  },
];

const arrNewSamples: NewSample[] = [];
let newSample: NewSample;
let timestamp: Timestamp;
let result: SteamIqFuncOutput;

fs.createReadStream("../POL-16.csv")
  .pipe(parse({ delimiter: "\t", from_line: 2 }))
  .on("data", function (row) {
    try {
      timestamp = Date.parse(row[0]);
      newSample = { timestamp, cycleCounts: +row[1], activity: +row[2] };
      arrNewSamples.push(newSample);
    } catch (err) {
      console.log(`Error occured: ${err}`);
    }
  })
  .on("end", function () {
    //console.log("finished");
    //console.log(arrNewSamples.at(-1));
    result = evalTrapStatus(arrNewSamples, arrTrapInfo, retainedData);
    console.log(`Evaluation for Pol-16 finished`);

    console.log(result.arrSamplesForStoring.at(46));
    console.log(result.arrSamplesForStoring.at(47));
    console.log(result.arrSamplesForStoring.at(48));
    console.log(result.arrSamplesForStoring.at(278));
    console.log(result.arrSamplesForStoring.at(279));
    console.log(result.arrSamplesForStoring.at(280));
    console.log(`The final result is:`);
    console.log(result.arrSamplesForStoring.at(-1));
  })
  .on("error", function (error) {
    console.log(error.message);
  });
*/
