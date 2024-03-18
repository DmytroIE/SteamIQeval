const prepTrapDataForStoring = (
  arrSamples: SampleForStoringInDb[],
  trapId: string,
  arrLastSamplesPrev: RetainedLastSample[]
): { forCsv: string; forIot: string } => {
  let forCsv: string = "";
  let forIot: string = "";
  let dateTime: Date;
  let dateTimeStr: string;
  let tsRounded: Timestamp;
  let proxyObj: ProxyObj;
  let proxyArr: ProxyObj[] = [];
  let roundedTsOfPrevSample: Timestamp = new Date(
    arrLastSamplesPrev[arrLastSamplesPrev.length - 1].timestamp
  ).setUTCMinutes(0, 0, 0);
  let totalLossesKgOfPrevSample =
    arrLastSamplesPrev[arrLastSamplesPrev.length - 1].totalLossesKg;
  let lossesKg: number;

  for (let sample of arrSamples) {
    dateTime = new Date(sample.ts);
    // round the timestamp to one hour
    tsRounded = dateTime.setUTCMinutes(0, 0, 0);
    // this part is made because the interval between consequitive samples that a SteamIQ
    // device sends is quite often 1-2 seconds smaller than 1 hour.
    // So, sometimes it happens that two adjancent samples have the same hour,
    // like 14:00:01 and  14:59:59. In this case we just include the first sample and
    // exclude the second one. But if it has losses then we add them to the nearest next sample
    if (roundedTsOfPrevSample === tsRounded) {
      continue;
    } else {
      if (sample.totalLossesKg < totalLossesKgOfPrevSample) { // it means that there was a reset
        lossesKg = sample.totalLossesKg;
      }
      else {
        lossesKg = sample.totalLossesKg - totalLossesKgOfPrevSample;
      }
      totalLossesKgOfPrevSample = sample.totalLossesKg;
    }

    // preparing for the STRATA format
    dateTimeStr =
      String(dateTime.getUTCFullYear()) +
      "-" +
      String(dateTime.getUTCMonth() + 1) +
      "-" +
      String(dateTime.getUTCDate()) +
      " " +
      String(dateTime.getUTCHours()) +
      ":00:00";
    forCsv +=
      dateTimeStr +
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
      sample.totalLossesKg +
      ";" +
      sample.totalLossesKwh +
      ";" +
      sample.totalLossesCo2 +
      ";" +
      sample.meanIntLeak * 1 +
      ";" +
      lossesKg +
      ";" +
      sample.extNoiseFactor +
      ";" +
      sample.trapIndex +
      ";" +
      sample.stype +
      ";\n";
    // prepaping ts for IoT hub in seconds
    tsRounded = tsRounded / 1000; // no necessity to round after division as it is already rounded
    proxyObj = { time: tsRounded };
    proxyObj[`${trapId}act`] = sample.activity;
    proxyObj[`${trapId}cc`] = sample.cycleCounts;
    proxyObj[`${trapId}temp`] = sample.temperature;
    proxyObj[`${trapId}bat`] = sample.battery;
    proxyObj[`${trapId}st`] = sample.status;
    //proxyObj[`${trapId}totkg`] = Math.round(sample.totalLossesKg*10)/10;
    proxyObj[`${trapId}losskg`] = lossesKg;
    proxyObj[`${trapId}enf`] = sample.extNoiseFactor;
    proxyArr.push(proxyObj);
  }
  forIot = JSON.stringify(proxyArr, null, "\t");
  return { forCsv, forIot };
};

export { prepTrapDataForStoring };
