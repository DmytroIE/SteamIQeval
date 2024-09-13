import { defaultRetainedData } from "../types/defaults";

// Constants
const THRESHOLD_MID_ACTIVITY = 7;
const THRESHOLD_HI_ACTIVITY = 27;
const THRESHOLD_EXTRA_HI_ACTIVITY = 53;
const THRESHOLD_CYCLE_COUNTS_EXT_NOISE = 13;
const LO_CC_WINDOW = 48;
const WINDOW_LENGTH_FOR_GOOD_STATUS = 48;
const WINDOW_LENGTH = 168; // used for evaluating Warning and leaking statuses
const WINDOW_LAST_SAMPLES = 8;
const NUM_HOURS_BTW_SAMPLES_OBS = 8;
const COEFF_BAD_STATUS = 0.8;
const PERC_HI_IN_ALL_HI_FOR_LEAKING = 0.8;
const PERC_HI_EXTRA_HI = 0.95;
const THRESHOLD_OK_SAMPLES_MODULATING = 0.1;
const THRESHOLD_OK_SAMPLES_CONST = 0.25;
const THRESHOLD_ACTIVITY_LOSSES = 19;

// The function that evaluates the status of the trap (eval function)
// This function takes a new portion of NewSample entities (delivered from the SteamIQ API), also it takes
// the information about the trap (its orifice, pressure at which it works, type of tyhe application it serves etc.)
// and the retained data (whic is defaultRetained data at the very first invocation),
// and calculates the new status, losses and other things by processing NewSample[] sample by sample
function evalTrapStatus(
  arrNewSamples: NewSample[],
  arrTrapInfo: TrapInfo[],
  retainedData: RetainedData
): SteamIqFuncOutput {
  // initialisation of the internal variables
  const arrSamplesForStoring: SampleForStoringInDb[] = [];
  let sample: SampleForStoringInDb;

  let {
    prevStatus,
    totalLossesKg,
    totalLossesKwh,
    totalLossesCo2,
    hoursOfLeaking,
    prevTrapIndex,
  } = retainedData;

  let arrActSamples: RetainedActiveSample[] =
    retainedData.arrActSamples.slice();
  let arrLastSamples: RetainedLastSample[] =
    retainedData.arrLastSamples.slice();

  let numLoMid: number;
  let numHiExtraHi: number;
  let percLoMid: number;
  let numHi: number;
  let percHiInAllHi: number;
  let percHiExtraHi: number;
  let numHiExtraHiRecalc: number;

  let status: Status = Status.Undefined; // initialized only for TS
  let trapIndex: number | null;
  let meanIntLeak: number;

  let multiplicatorLossesKg: number;
  let multiplicatorLossesKwh: number;
  let multiplicatorLossesCo2: number;
  let orifDiamOptimized: number;

  let thresholdOkSamples: number = 0; // initialized only for TS

  let extNoiseFactor: number = 0;
  let extNoiseFactorLoCc: number;
  let extNoiseFactorHiCc: number;
  let numHiCcSamplesInRow: number;
  let startIdx: number;
  let finishIdx: number;
  let tsPrev: number;
  let sumHiCc: number;
  let numActSamples: number;
  let sumLoCc: number;
  let coef: number;

  // main cycle, where new samples get processed one by one
  for (let item of arrNewSamples) {
    sample = {
      ts: item.timestamp,
      activity: item.activity,
      cycleCounts: item.cycleCounts,
      stype: 0, // this value will be assigned later
      status: Status.Undefined, // this value will be assigned later
      trapIndex: 0, // this value will be assigned
      totalLossesKg: 0, // this value will be assigned later
      totalLossesKwh: 0, // this value will be assigned later
      totalLossesCo2: 0, // this value will be assigned later
      meanIntLeak: 0, // this value will be assigned later
      extNoiseFactor: 0, // this value will be assigned later
      temperature: item.temperature,
      battery: item.battery,
    };

    // finding proper trapInfo for this sample
    trapIndex = null;
    for (let i = 0; i < arrTrapInfo.length; i++) {
      if (item.timestamp >= arrTrapInfo[i].validFrom) {
        trapIndex = i;
        sample.trapIndex = i;
      }
    }
    if (trapIndex === null) {
      throw new Error("No trap data valid for the timeframe of the samples");
    }
    // and preparing some coefficients that will be used further in the algorithm
    orifDiamOptimized = Math.min(
      arrTrapInfo[trapIndex].orifDiam,
      33.583 * Math.pow(arrTrapInfo[trapIndex].pressure + 1, -0.415)
    );
    multiplicatorLossesKg =
      (47.12 *
        Math.pow(orifDiamOptimized / 25.4, 2) *
        Math.pow(arrTrapInfo[trapIndex].pressure * 14.50377 + 14.7, 0.97) *
        0.7 *
        0.36 *
        0.45359) /
      100.0; // 0.45359 is a conversion factor from lb to kg
    multiplicatorLossesKwh =
      arrTrapInfo[trapIndex].steamEnthalpy /
      ((arrTrapInfo[trapIndex].efficiency / 100.0) * 3600);
    multiplicatorLossesCo2 = arrTrapInfo[trapIndex].co2factor / 1000.0;

    thresholdOkSamples = arrTrapInfo[trapIndex].isModulating
      ? THRESHOLD_OK_SAMPLES_MODULATING
      : THRESHOLD_OK_SAMPLES_CONST;

    if (prevTrapIndex !== trapIndex && arrTrapInfo[trapIndex].reset) {
      // reset the statistics
      ({
        prevStatus,
        totalLossesKg,
        totalLossesKwh,
        totalLossesCo2,
        hoursOfLeaking,
      } = defaultRetainedData);
      arrActSamples = [];
      arrLastSamples = structuredClone(defaultRetainedData.arrLastSamples);

      prevTrapIndex = trapIndex;
      status = Status.Undefined;
    } else {
      status = prevStatus;
    }

    // assigning sample types depending of the combination of leak and cycleCounts
    if (sample.activity === 0 && sample.cycleCounts === 0) {
      sample.stype = SampleTypes.Cold;
    } else if (sample.activity === 0 && sample.cycleCounts > 0) {
      sample.stype = SampleTypes.Flooded;
    } else if (sample.activity <= THRESHOLD_MID_ACTIVITY) {
      sample.stype = SampleTypes.LoActive;
    } else if (sample.activity <= THRESHOLD_HI_ACTIVITY) {
      sample.stype = SampleTypes.MidActive;
    } else if (sample.activity <= THRESHOLD_EXTRA_HI_ACTIVITY) {
      sample.stype = SampleTypes.HiActive;
    } else {
      sample.stype = SampleTypes.ExtraHiActive;
    }

    if (sample.stype > SampleTypes.Flooded) {
      arrActSamples.push({
        timestamp: sample.ts,
        activity: sample.activity,
        cycleCounts: sample.cycleCounts,
        stype: sample.stype,
        inTripletHiCc: 0,
        loCcScore: 0,
      });
    }

    arrActSamples = arrActSamples.slice(
      Math.max(0, arrActSamples.length - WINDOW_LENGTH),
      arrActSamples.length
    );

    // calculating external noise probability

    // HI CC----------------------
    numHiCcSamplesInRow = 0;
    tsPrev = 0;
    if (arrActSamples.length >= 5) {
      // first scan - finding 3 of 5 samples with CC=14-15
      let k = 0;
      while (k <= arrActSamples.length - 5) {
        //first scan
        let m = 0;
        numHiCcSamplesInRow = 0;
        tsPrev = arrActSamples[k].timestamp;
        while (m < 5) {
          if (
            arrActSamples[k + m].cycleCounts >
              THRESHOLD_CYCLE_COUNTS_EXT_NOISE &&
            arrActSamples[k + m].activity > THRESHOLD_MID_ACTIVITY &&
            arrActSamples[k + m].timestamp - tsPrev <
              NUM_HOURS_BTW_SAMPLES_OBS * 3600000
          ) {
            numHiCcSamplesInRow++;
          }
          tsPrev = arrActSamples[k + m].timestamp;
          m++;
        }

        if (numHiCcSamplesInRow >= 3) {
          tsPrev = arrActSamples[k].timestamp;
          for (let u = 0; u < 5; u++) {
            if (
              arrActSamples[k + u].cycleCounts >
                THRESHOLD_CYCLE_COUNTS_EXT_NOISE &&
              arrActSamples[k + u].activity > THRESHOLD_MID_ACTIVITY &&
              arrActSamples[k + u].timestamp - tsPrev <
                NUM_HOURS_BTW_SAMPLES_OBS * 3600000
            ) {
              arrActSamples[k + u].inTripletHiCc = 1;
            }
            tsPrev = arrActSamples[k + u].timestamp;
          }
        }
        k++;
      }
    }

    //LO CC------------------------------------------
    if (arrActSamples.length > 0) {
      for (let i = 0; i < arrActSamples.length; i++) {
        //
        if (
          arrActSamples[i].cycleCounts === 0 &&
          arrActSamples[i].activity > THRESHOLD_HI_ACTIVITY
        ) {
          if (arrActSamples[i].activity > THRESHOLD_EXTRA_HI_ACTIVITY) {
            arrActSamples[i].loCcScore = 3;
          } else {
            arrActSamples[i].loCcScore = 2;
          }

          startIdx = Math.max(0, i - LO_CC_WINDOW);
          finishIdx = Math.max(0, i - 1);
          for (let o = finishIdx; o >= startIdx && i > 0; o--) {
            if (arrActSamples[o].activity > THRESHOLD_EXTRA_HI_ACTIVITY) {
              coef = 1.5;
            } else {
              coef = 1;
            }
            if (
              arrActSamples[o].cycleCounts === 1 &&
              arrActSamples[o].activity > THRESHOLD_HI_ACTIVITY
            ) {
              arrActSamples[o].loCcScore = Math.max(
                arrActSamples[o].loCcScore,
                (coef * (LO_CC_WINDOW - (finishIdx - o))) / LO_CC_WINDOW
              );
            } else if (
              arrActSamples[o].cycleCounts === 0 &&
              arrActSamples[o].activity > THRESHOLD_HI_ACTIVITY
            ) {
              arrActSamples[o].loCcScore = Math.max(
                arrActSamples[o].loCcScore,
                coef * (2 + (LO_CC_WINDOW - (finishIdx - o)) / LO_CC_WINDOW)
              );
            }
          }
          startIdx = Math.min(arrActSamples.length - 1, i + 1);
          finishIdx = Math.min(arrActSamples.length - 1, i + LO_CC_WINDOW);
          for (
            let o = startIdx;
            o <= finishIdx && i < arrActSamples.length - 1;
            o++
          ) {
            if (arrActSamples[o].activity > THRESHOLD_EXTRA_HI_ACTIVITY) {
              coef = 1.5;
            } else {
              coef = 1;
            }
            if (
              arrActSamples[o].cycleCounts === 1 &&
              arrActSamples[o].activity > THRESHOLD_HI_ACTIVITY
            ) {
              arrActSamples[o].loCcScore = Math.max(
                arrActSamples[o].loCcScore,
                (coef * (startIdx + LO_CC_WINDOW - o)) / LO_CC_WINDOW
              );
            } else if (
              arrActSamples[o].cycleCounts === 0 &&
              arrActSamples[o].activity > THRESHOLD_HI_ACTIVITY
            ) {
              arrActSamples[o].loCcScore = Math.max(
                arrActSamples[o].loCcScore,
                coef * (2 + (startIdx + LO_CC_WINDOW - o) / LO_CC_WINDOW)
              );
            }
          }
        }
      }
    }
    sumHiCc = 0;
    numActSamples = 0;
    sumLoCc = 0;
    for (let k = 0; k < arrActSamples.length; k++) {
      //
      if (arrActSamples[k].inTripletHiCc) {
        sumHiCc += arrActSamples[k].inTripletHiCc;
      }
      if (arrActSamples[k].activity > THRESHOLD_MID_ACTIVITY) {
        numActSamples += 1;
      }
      sumLoCc += arrActSamples[k].loCcScore;
    }

    if (numActSamples === 0) {
      numActSamples = 1;
    }

    extNoiseFactorHiCc = Math.sqrt(sumHiCc / numActSamples);
    extNoiseFactorLoCc = Math.min(1, sumLoCc / (WINDOW_LENGTH / 3));

    extNoiseFactor = Math.min(1, extNoiseFactorHiCc + extNoiseFactorLoCc);

    // status evaluation

    // preparing an array that contains WINDOW_LENGTH active samples
    if (arrActSamples.length > 0) {
      numLoMid =
        findNumOfSamples(arrActSamples, SampleTypes.LoActive) +
        findNumOfSamples(arrActSamples, SampleTypes.MidActive);

      numHi = findNumOfSamples(arrActSamples, SampleTypes.HiActive);
      numHiExtraHi =
        numHi + findNumOfSamples(arrActSamples, SampleTypes.ExtraHiActive);

      // The number of Hi and ExtraHi active samples is reduced by means of the extNoiseFactor
      numHiExtraHiRecalc = numHiExtraHi * (1.0 - extNoiseFactor); // that is why we need this extNoiseFactor

      // protection from zero divivsion
      if (numLoMid + numHiExtraHiRecalc > 0) {
        percLoMid = numLoMid / (numLoMid + numHiExtraHiRecalc);
        percHiExtraHi = numHiExtraHiRecalc / (numLoMid + numHiExtraHiRecalc);
      } else {
        percLoMid = 0;
        percHiExtraHi = 0;
      }

      if (numHiExtraHi === 0) {
        percHiInAllHi = 0;
      } else {
        percHiInAllHi = numHi / numHiExtraHi;
      }
    } else {
      numLoMid = 0;
      numHiExtraHi = 0;
      numHiExtraHiRecalc = 0;
      percHiInAllHi = 0;
      percLoMid = 0;
      percHiExtraHi = 0;
    }

    // evaluating status

    if (
      ((numLoMid + numHiExtraHiRecalc > WINDOW_LENGTH_FOR_GOOD_STATUS &&
      numLoMid > WINDOW_LENGTH_FOR_GOOD_STATUS * 0.5 &&
      percLoMid > thresholdOkSamples) || (numLoMid > 3 && numHiExtraHi === 0)) &&
      prevStatus < Status.Warning
    ) {
      status = Status.Good;
    }
    // sometimes it happens, when there are no LoMid samples and all HiExtraHi samples are supressed by extNoiseFactor
    else if (numLoMid < 1 && prevStatus === Status.Good) {
      status = Status.Undefined;
    } else if (
      numLoMid + numHiExtraHiRecalc > WINDOW_LENGTH * COEFF_BAD_STATUS &&
      percLoMid <= thresholdOkSamples &&
      prevStatus < Status.Leaking
    ) {
      status = Status.Warning;
      if (
        percHiExtraHi > PERC_HI_EXTRA_HI &&
        percHiInAllHi > PERC_HI_IN_ALL_HI_FOR_LEAKING
      ) {
        status = Status.Leaking;
      }
    }

    // calculating losses
    // if the transition from "Undefined" or "Good" to "Warning" or "Bad" status happened exactly at this step
    // the function looks back and calculates losses for previous WINDOW_LENGTH samples
    if (prevStatus < Status.Warning && status >= Status.Warning) {
      ({
        lossesKg: totalLossesKg,
        lossesKwh: totalLossesKwh,
        lossesCo2: totalLossesCo2,
        hours: hoursOfLeaking,
      } = arrActSamples.reduce(
        (acc, curr) => {
          if (curr.activity > THRESHOLD_ACTIVITY_LOSSES) {
            const lossesKg = curr.activity * multiplicatorLossesKg;
            const lossesKwh = lossesKg * multiplicatorLossesKwh;
            const lossesCo2 = lossesKwh * multiplicatorLossesCo2;
            return {
              lossesKg: acc.lossesKg + lossesKg,
              lossesKwh: acc.lossesKwh + lossesKwh,
              lossesCo2: acc.lossesCo2 + lossesCo2,
              hours: acc.hours + 1,
            };
          }
          return acc;
        },
        { lossesKg: 0.0, lossesKwh: 0.0, lossesCo2: 0.0, hours: 0 }
      ));
    }
    // else the losses for this particular sample are added to the totalizers
    else if (prevStatus >= Status.Warning && status >= Status.Warning) {
      if (sample.activity > THRESHOLD_ACTIVITY_LOSSES) {
        totalLossesKg += sample.activity * multiplicatorLossesKg;
        totalLossesKwh +=
          sample.activity * multiplicatorLossesKg * multiplicatorLossesKwh;
        totalLossesCo2 +=
          sample.activity *
          multiplicatorLossesKg *
          multiplicatorLossesKwh *
          multiplicatorLossesCo2;
        hoursOfLeaking += 1;
      }
    }
    meanIntLeak = hoursOfLeaking === 0 ? 0.0 : totalLossesKg / hoursOfLeaking;

    arrLastSamples.push({
      timestamp: sample.ts,
      activity: sample.activity,
      cycleCounts: sample.cycleCounts,
      stype: sample.stype,
      temperature: sample.temperature,
      totalLossesKg,
    });

    // update this array, maybe it will be able to use it for current state evaluation
    // on the other hand, the timestamp of last item of this array is used
    // for defining the startTs timestamp in next requests to the API
    arrLastSamples = arrLastSamples.slice(
      Math.max(0, arrLastSamples.length - WINDOW_LAST_SAMPLES),
      arrLastSamples.length
    );

    // filling the sample information
    sample.status = status;
    sample.totalLossesKg = totalLossesKg;
    sample.totalLossesKwh = Math.round(totalLossesKwh * 10) / 10;
    sample.totalLossesCo2 = Math.round(totalLossesCo2 * 100) / 100;
    sample.meanIntLeak = Math.round(meanIntLeak * 10) / 10;
    sample.extNoiseFactor = Math.round(extNoiseFactor * 1000) / 10;

    arrSamplesForStoring.push(sample);

    prevStatus = status;
  }

  // preparing the data with intermediate calculations to be retained and used in next calculations
  const newRetainedData: RetainedData = {
    prevStatus,
    totalLossesKg,
    totalLossesKwh,
    totalLossesCo2,
    hoursOfLeaking,
    prevTrapIndex,
    arrActSamples,
    arrLastSamples,
  };

  return {
    arrSamplesForStoring,
    newRetainedData,
  };
}

// A function-helper
function findNumOfSamples(arr: RetainedActiveSample[], stype: SampleTypes) {
  return arr.filter((curr) => curr.stype === stype).length;
}

export { evalTrapStatus };
