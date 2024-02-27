let lastProcTs: Timestamp = 0;

const prepTrapDataForStoring = (
  arrSamples: SampleForStoringInDb[],
  trapId: string
): { forCsv: string; forIot: string } => {
  let forCsv: string = "";
  let forIot: string = "";
  let dateTime: string | Date;
  let ts: Timestamp;
  let proxyObj: ProxyObj;
  let proxyArr: ProxyObj[] = [];

  for (let sample of arrSamples) {
    dateTime = new Date(sample.ts);
    ts = dateTime.setUTCMinutes(0, 0, 0);
    if (lastProcTs === ts) {
      continue;
    }
    lastProcTs = ts;
    // preparing for the STRATA format
    dateTime =
      String(dateTime.getUTCFullYear()) +'-'+
      String(dateTime.getUTCMonth() + 1) +'-'+
      String(dateTime.getUTCDate()) + ' '+
      String(dateTime.getUTCHours())+
      ":00:00";
    forCsv +=
      dateTime +
      ";" +
      sample.activity +
      ";" +
      sample.cycleCounts +
      ";" +
      sample.temperature +
      ";" +
      sample.battery +
      ";" +
      sample.status +
      ";" +
      Math.round(sample.totalLossesKg*10)/10 +
      ";" +
      Math.round(sample.totalLossesKwh*10)/10 +
      ";" +
      Math.round(sample.totalLossesCo2*100)/100 +
      ";" +
      Math.round(sample.meanIntLeak*10)/10 +
      ";" +
      Math.round(sample.extNoiseFactor*1000)/10 + // percent
      ";" +
      Math.round(sample.floodFactor*100) + // percent
      ";" +
      sample.trapIndex +
      ";" +
      sample.stype +
      ";\n";
    // prepaping ts for IoT hub in seconds
    ts = ts / 1000;
    proxyObj = { time: ts };
    proxyObj[`${trapId}act`] = sample.activity;
    proxyObj[`${trapId}cc`] = sample.cycleCounts;
    proxyObj[`${trapId}temp`] = sample.temperature;
    proxyObj[`${trapId}bat`] = sample.battery;
    proxyObj[`${trapId}st`] = sample.status;
    proxyObj[`${trapId}totkg`] = Math.round(sample.totalLossesKg*10)/10;
    proxyObj[`${trapId}enf`] = Math.round(sample.extNoiseFactor*1000)/10;
    proxyArr.push(proxyObj);
  }
  forIot = JSON.stringify(proxyArr, null, "\t");
  return { forCsv, forIot };
};

export { prepTrapDataForStoring };
