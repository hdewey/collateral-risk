// ---------------- imports ----------------

// fetch sushiswap exchange data (they handle rate limits on their end)
import sushiData from "@sushiswap/sushi-data";

// sushiswap & uniswap objects for deterministic pairID creation 
import { ChainId as sushi_ChainId, Token as sushi_Token, Pair as sushi_Pair } from '@sushiswap/sdk'
import { ChainId as uni_ChainId, Token as uni_Token, Pair as uni_Pair } from '@uniswap/sdk'

// importing asset and pool overrides
import { overrides as poolOverrides } from "../overrides/poolOverrides.json";
import { overrides as assetOverrides } from "../overrides/assetOverrides.json"; 

// for calculating overall score
import { abs, exp, max, mean, sqrt, variance } from 'mathjs';

// lodash for arrays (specifically for dev override functions)
import _ from 'lodash';

import fetch from 'node-fetch';

import { queuedRequest } from "./smartBalancer";

// have to checksum addresses for hash to create pairID creation (use require because checksum has no types)
const checksum = require('eth-checksum');

// ---------------- rss-wide dev functions ----------------


// return test with all scores 0 (used for ETH)
export const returnSafeTest = (address: string, symbol: string):ScoreBlock => {
  return {
    score: {
      address   : address,
      symbol    : symbol,
      historical: 0,
      volatility: 0,
      crash     : 0,
      liquidity : 0,
      overall   : 0
    } as Score,
    assetInfo: {
      collateralFactor: 0,
      tokenDown       : 0,
      marketCap       : 0,
    }
  } as ScoreBlock
}

// return test for non-scorable assets
export const returnMissingTest = (address: string, symbol: string):ScoreBlock => {
  return {
    score: {
      address   : address,
      symbol    : symbol,
      historical: "*",
      volatility: "*",
      crash     : "*",
      liquidity : "*",
      overall   : "*"
    } as Score,
    assetInfo: {
      collateralFactor: null,
      tokenDown       : null,
      marketCap       : null,
    }
  } as ScoreBlock
}

// ---------------- testing provider functions ----------------


// returns latest block height (2 behind to sync w subgraphs)
export const fetchLatestBlock = async (web3: any):Promise<number> => {
  const blockHeight = await web3.eth.getBlockNumber() - 2; 
  return blockHeight;
}

// calculate overall score from assets
export const calcOverall = (scoreBlocks: ScoreBlock[]):number|string => {

      // return only score from a ScoreBlock
  const scores:Score[] = scoreBlocks.map( (scoreBlock) => scoreBlock.score);

  // throw out assets that weren't scored
  const filtered:Score[] = scores.filter(function(value){ 
    return value.overall !== '*';
  });

  const overall:number[] = filtered.map( (score: Score) => {
    return score.overall as number;
  })

  if (overall.length > 0) {
    return max(...overall)
  } else {
    return "*";
  }
}

// ---------------- risk scoring tool functions ----------------

// loop through coingecko tickers to check audits
export const checkAudits = (tickers: any):boolean => {
  const reputableExchanges: any[] = [];
  try {
    for (const exchange of tickers) {
      const name = exchange.market.identifier;
      if (
        !reputableExchanges.includes(name) &&
        name !== "uniswap" &&
        exchange.trust_score === "green"
      ) {
        reputableExchanges.push(name);
      }
    }
  } finally {
    return reputableExchanges.length > 0 ? true : false;
  }
}

// // calculate volatility from price array
// export const calcVolatility = (prices: number[]) => {
//   return sqrt (variance(prices) )
// }

export const calcVolatility = (prices: number[]) => {

  const percentagePrices = prices.map( (price, index) => {
    if (index == 0) return 0
    const prevPrice = prices[index - 1];
    return (( price - prevPrice ) / prevPrice) * 100;
  })

  const meanPrice = mean(percentagePrices);
  const squaredDeviations = percentagePrices.map( (price) => {

    const deviation =  abs (meanPrice - price);

    return deviation ** 2;
  } )

  const sum = squaredDeviations.reduce( (ps, v) => ps + v, 0)

  return sum / percentagePrices.length
}


// ---------------- Sushiswap ----------------

export const currentETHPrice = async ():Promise<any> => {
  return await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then(res => res.json());
}


// ---------------- historical backtest functions ----------------
 

// ---------------- dev override functions ---------------

// these functions handle the matching of an address or poolID to it's corresponding override

// array of address overrides
const addressOvr = _.compact(assetOverrides.map( (override) => {
  if (override.underlying) return override 
  else return null
}));

// array of test specific overrides
const testOvr = _.compact(assetOverrides.map( (override) => {
  if (override.tests) return override
  else return null
}));

// array of pool overrides (multisig)
const poolOvr = _.compact(poolOverrides.map( (override) => {
  if (override.poolID) return override
  else return null
}));

export const fetchAddressOverride = (address: string) => {
  let override = addressOvr.find (o => o.address === address);
  return override ? override.underlying : address
}

export const fetchTestOverride =  async (address: string) => {
  let override = testOvr.find( o => o.address === address)
  if (override) {
    return await fillOverride(override.tests)
  } else {
    return await fillOverride([]);
  }
}

// return override for pool specific tests (solely multisig at the moment)
export const fetchMultisigOverride = (poolID: string) => {
  let override = poolOvr.find (o => o.poolID === poolID);

  if (override === undefined) return false
  else return override
}

const fillOverride = async (override: {test: string, section: string, value: boolean}[] | []) => {

  let filledOverride = {
    crash: {
      twitter  : true,
      audit    : true,
      marketCap: true
    },
    liquidity: {
      totalLiquidity: true,
      lpAddresses   : true
    },
    volatility: {
      marketCap : true,
      volatility: true
    },
    historical: {
      backtest: true
    }
  } as FilledOverride
  
  if (override) {
    override.forEach((element) => {
      (filledOverride as any)[element.test][element.section] = element.value;
    });
  }

  return filledOverride;
}


// ---------------- Types ----------------

export interface ScoreBlock {
  score: Score,
  assetInfo: {
    collateralFactor: number | null,
    tokenDown       : number | null,
    marketCap       : number | null,
  }
}

export interface SushiBlock {
  block: number,
  data: {
    id       : string,
    token0   : { symbol: string },
    token1   : { symbol: string },
    reserve0 : number,
    reserve1 : number,
    totalSupply : number,
    reserveETH  : number,
    reserveUSD  : number,
    token0Price : number,
    token1Price : number,
    volumeToken0: number,
    volumeToken1: number,
    volumeUSD   : number,
    txCount     : number,
    trackedReserveETH : number,
    untrackedVolumeUSD: number
  }
}

export interface Score {
  address   : string,
  symbol    : string,

  historical: number | string,
  volatility: number | string,
  crash     : number | string,
  liquidity : number | string,
  overall   : number | string
}

export interface BacktestConfig {
  period      : number, // normally 68 blocks is 15 mins
  segmentsBack: number, // should be divisible by 100 (amt of blocks to go back)
  end         : number // getLatestBlock() from web3
  
  financials : {
    liquidationIncentive: number,
    collateralFactor    : number
  }

  pair: any
}

// type for fetched data from different apis (unsorted)
export type AssetData = {
  address             : string,
  symbol              : string,
  totalLiquidity      : number,
  marketCap           : number,
  audits              : boolean,
  priceChange         : number,
  fully_diluted_value : number,
  twitterFollowers    : number,
  lpAddresses         : number,
  tokenDown           : number | null,
  collateralFactor    : number,
  liquidationIncentive: number
}

export type FetchedData = {
  symbol             : string,
  asset_market_cap   : number,
  fully_diluted_value: number,
  price_usd          : number,
  tickers            : any,
  twitter_followers  : number,
  totalLiquidity     : number,
  prices             : number[],
  ethplorer          : number,
  bestPair           : any
}


export interface PriceSet {
  block : { 
    start: number, 
    end  : number 
  },
  prices: number[]
}

// type for override object
type FilledOverride = {
  crash: { 
    twitter: boolean; 
    audit: boolean; 
    marketCap: boolean; 
  }; 
  liquidity: { 
    totalLiquidity: boolean; 
    lpAddresses: boolean; 
  }; 
  volatility: { 
    marketCap: boolean; 
    volatility: boolean; 
  }; 
  historical: { 
    backtest: boolean; 
  };
}