import { logger } from "./logger";

const STEAMIQ_API_LIMIT = 20000;

let token: string = "";

async function* steamIqChunkDataFetcher(
  siqDevId: string,
  startTs: number,
  endTs: number,
  chunkSize: number = 100,
  siqDevName: string = ''
) {
  try {
    if (startTs > endTs) {
      throw new Error(
        `The start time ${startTs} of the SteamIQ request is greater than end time ${endTs}`
      );
    }

    const username = process.env.SIQ_API_USERNAME;
    const password = process.env.SIQ_API_PASSWORD;
    if (!username || !password) {
      throw new Error(`No username or password is found for SteamIQ API`);
    }

    let itemData: any;
    let responseItemInfo: Response | undefined;
    if (token) {
      responseItemInfo = await getDataWithToken(
        token,
        siqDevId,
        startTs,
        endTs
      );
      if (responseItemInfo.ok !== true) {
        throw new Error("Cannot deliver data from SteamIQ API");
      } else {
        itemData = await responseItemInfo.json();
      }
    }
    if ((responseItemInfo && responseItemInfo.ok !== true) || !token) {
      // try to update the token first
      const responseToken = await fetch(
        "https://app.steamiq.com/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        }
      );
      if (responseToken.ok !== true) {
        throw new Error("Cannot log in SteamIQ API");
      }
      const jsonToken = await responseToken.json();
      token = jsonToken.token;
      //try again
      responseItemInfo = await getDataWithToken(
        token,
        siqDevId,
        startTs,
        endTs
      );
      if (responseItemInfo.ok !== true) {
        throw new Error("Cannot deliver data from SteamIQ API");
      } else {
        itemData = await responseItemInfo.json();
      }
    }

    if (
      itemData.leak &&
      itemData.cycleCounts &&
      itemData.leak.length &&
      itemData.cycleCounts.length &&
      itemData.leak.length === itemData.cycleCounts.length
    ) {
      //---------------------------------------------------------
      let dataFrame: NewSample[] = [];
      for (let i = 0; i < itemData.leak.length; i++) {
        const sample: NewSample = {
          timestamp: itemData.leak[i].ts,
          activity: itemData.leak[i].value,
          cycleCounts: itemData.cycleCounts[i].value,
          temperature: null,
          battery: null,
        };
        dataFrame.push(sample);
      }
      if (itemData.temperature && itemData.temperature.length > 0) {
        let lastTemp = itemData.temperature.at(-1).value;
        let lastBat = Math.ceil((itemData.battery.at(-1).value / 255) * 100);
        for (let i = dataFrame.length - 1; i >= 0; i--) {
          for (let j = itemData.temperature.length - 1; j >= 0; j--) {
            if (itemData.temperature[j].ts === dataFrame[i].timestamp) {
              lastTemp = itemData.temperature[j].value;
              lastBat = Math.ceil((itemData.battery[j].value / 255) * 100);
              break;
            }
          }
          dataFrame[i].temperature = lastTemp;
          dataFrame[i].battery = lastBat;
        }
      }

      //------------------------------------------------------
      let dataChunk: NewSample[] = [];
      for (let i = 0; i < dataFrame.length; i++) {
        dataChunk.push(dataFrame[i]);
        if (dataChunk.length >= chunkSize) {
          yield dataChunk;
          dataChunk = [];
        }
      }
      if (dataChunk.length > 0) {
        yield dataChunk;
      } else return;
    } else {
      if (JSON.stringify(itemData) === "{}") {
        const name = !siqDevName ? siqDevId: siqDevName;
        logger.info(
          `No data for ${name} from ${new Date(
            startTs
          ).toISOString()} till ${new Date(
            endTs
            ).toISOString()}`
        );
        return;
      }
      throw new Error("The data received from the SteamIQ API is corrupted");
    }
  } catch (err) {
    logger.error(err as string);
    return;
  }
}

const getDataWithToken = async (
  token: string,
  siqDevId: string,
  startTs: Timestamp,
  endTs: Timestamp
): Promise<Response> => {
  const headers = { Authorization: `Bearer ${token}` };
  const getItemInfoUrl = `https://app.steamiq.com/api/plugins/telemetry/DEVICE/${siqDevId}/values/timeseries`;
  const searchParams = `keys=leak%2CcycleCounts%2Ctemperature%2Cbattery&startTs=${startTs}&endTs=${endTs}&
      interval=3600000&limit=${STEAMIQ_API_LIMIT}&agg=NONE&orderBy=ASC&useStrictDataTypes=true`;

  return fetch(getItemInfoUrl + "?" + searchParams, {
    method: "GET",
    headers,
  });
};

export { steamIqChunkDataFetcher };
