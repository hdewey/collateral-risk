import fetch from 'node-fetch';

import _ from 'lodash';

import { abs, max, mean  } from 'mathjs';



// return test with all scores 0 (used for ETH)
export const returnSafeTest = (address: string, symbol: string):ScoreSet => {
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
  } as ScoreSet
}

// return test for non-scorable assets
export const returnMissingTest = (address: string, symbol: string):ScoreSet => {
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
  } as ScoreSet
}

// returns latest block height (2 behind to sync w subgraphs)
export const fetchLatestBlock = async (web3: any):Promise<number> => {
  const blockHeight = await web3.eth.getBlockNumber() - 2; 
  return blockHeight;
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

export const currentETHPrice = async ():Promise<any> => {
  return await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then(res => res.json());
}

// ---------------- Types ----------------

export interface ScoreSet {
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