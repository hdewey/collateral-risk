import { Score } from "./rssUtils"

export default (rss: RSS) => {
  return makePoolRSS(rss);
}

const letterScore = (totalScore: number|string):string => {
  if (totalScore === 0) {
    return "A";
  }

  if (totalScore === 1) {
    return "B";
  }

  if (totalScore === 2) {
    return "C";
  }

  if (totalScore === 3) {
    return "D";
  }

  if (totalScore === "*") {
    return "*"
  }

  else {
    return "F";
  }
};

const makePoolRSS = (rss: RSS): PoolRSS => {

  const poolAssetMap: HashMap<Score> = {};

  rss.scores.forEach( (asset) => {

    const assetLetterScore = {
      address   : asset.score.address,
      symbol    : asset.score.symbol,
    
      historical: letterScore(asset.score.historical),
      volatility: letterScore(asset.score.volatility),
      crash     : letterScore(asset.score.crash),
      liquidity : letterScore(asset.score.liquidity),
      overall   : letterScore(asset.score.overall)
      
    } as Score

    poolAssetMap[asset.score.address] = assetLetterScore;
  })

  return {
    poolID: rss.poolID,
    overall: letterScore(rss.overall),
    scores: poolAssetMap,
    lastUpdated: rss.lastUpdated
  } as PoolRSS

}

type HashMap<T> = {
  [key: string]: T
}

type RiskScoresAsMap = {
  [key: string]: any,
}

export type PoolRSS = {
  poolID: string,
  overall: string,
  scores: RiskScoresAsMap,
  scoreFails: string[],
  lastUpdated: string
}

export type RSS = {
  poolID: string
  overall: string | number,
  multisig: boolean,
  scores: ScoreBlock[],
  lastUpdated: string
}

export type ScoreBlock = {
  score: Score,
  assetInfo: {
    collateralFactor: number | null,
    tokenDown       : number | null,
    marketCap       : number | null,
  }
}