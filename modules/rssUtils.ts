// ---------------- imports ----------------

// fetch sushiswap exchange data (they handle rate limits on their end)
import sushiData from "@sushiswap/sushi-data";

// sushiswap & uniswap objects for deterministic pairID creation 
import { ChainId as sushi_ChainId, Token as sushi_Token, Pair as sushi_Pair } from '@sushiswap/sdk'
import { ChainId as uni_ChainId, Token as uni_Token, Pair as uni_Pair } from '@uniswap/sdk'

// importing asset and pool overrides
import { overrides as poolOverrides } from "./overrides/poolOverrides.json";
import { overrides as assetOverrides } from "./overrides/assetOverrides.json"; 

// for calculating overall score
import { max } from 'mathjs';

// lodash for arrays (specifically for dev override functions)
import _ from 'lodash';

import fetch from 'node-fetch';

// keep requests under rate-limits
import Queue from 'smart-request-balancer';

// using uuid as unique request identifier for queued request function
import { v4 as uuidv4 } from 'uuid';

// have to checksum addresses for hash to create pairID creation (use require because checksum has no types)
const checksum =  require('eth-checksum');

// ---------------- rss-wide dev functions ----------------

// calculate hash of token-WETH with sushiswap factory
export const sushiswapFetchPairID = async (address: string):Promise<string> => {
  const weth   = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  const token0 = new sushi_Token(sushi_ChainId.MAINNET, checksum.encode(address), 18);
  const token1 = new sushi_Token(sushi_ChainId.MAINNET, checksum.encode(weth), 18);
  const pair   = sushi_Pair.getAddress(token0, token1);

  return pair.toLowerCase();
}

// calculate hash of token-WETH with uniswap factory
export const uniswapFetchPairID = async (address: string):Promise<string> => {
  const weth   = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  const token0 = new uni_Token(uni_ChainId.MAINNET, checksum.encode(address as String), 18);
  const token1 = new uni_Token(uni_ChainId.MAINNET, checksum.encode(weth), 18);
  const pair   = uni_Pair.getAddress(token0, token1);

  return pair.toLowerCase();
}

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

// check if contract address is listed on coingecko
export const checkCoingecko = async (address: string):Promise<boolean> => {
  return await fetch(
    `https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}`
  ).then(async (res) => {
    const data = await res.json()
    if (data.error) {
      return false
    } else {
      return true
    }
  }).catch(e => {
    return false;
  })
}

// test if asset is listed in a pool on sushiswap
export const checkSushiswap = async (address: string):Promise<boolean> => {
  const pairAddress = await sushiswapFetchPairID(address);
  const pair = await sushiData.exchange.pair({pair_address: pairAddress.toLowerCase()})
  .then(() => true)
  .catch(() => false)
  return pair;
}

// test if asset is listed in a pool on uniswap
export const checkUniswap = async (address: string):Promise<boolean> => {
  const id = await uniswapFetchPairID(address).then( id => id.toLowerCase());

  const query = `
    {
      pair(id: "${id}") {
        id
      }
    }
  `;

  let uniswap = await queuedRequest("https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2", 'uniswap-post', address, query);

  // if pair exists, asset is listed on uniswap
  if (uniswap.data.pair) {
    return true;
  } else {
    return false;
  }
}

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

// mutliply sushiswap and uniswap liquidity by asset's most recent price
export const calcTotalLiquidity = async (sushiLiquidity: number, uniLiqudity: number, assetCurrentPrice: number):Promise<number> => {
  if ( !uniLiqudity && sushiLiquidity) {
    return sushiLiquidity * assetCurrentPrice;
  } else if (uniLiqudity && !sushiLiquidity) {
    return uniLiqudity * assetCurrentPrice
  } else if (uniLiqudity && sushiLiquidity) {
    return (sushiLiquidity + uniLiqudity) * assetCurrentPrice;
  } 
  else {
    console.log('uh oh - no sushiswap or uniswap liquidity')
    return 0;
  }
}

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

// calculate volatility from price array
export const calcVolatility = (prices: number[]) => {
  return Math.max(...prices) / Math.min(...prices);
}


// ---------------- Sushiswap ----------------

export const currentETHPrice = async ():Promise<any> => {
  return await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then(res => res.json());
}

// used to parse eth-dai blocks for eth price[]
export const parseForPrice = (blocks: SushiBlock[]):number[] => {
  let prices:any[] = [];
  try {
    for (let i = 0; i < blocks.length; i++) {
      let block = blocks[i].data;
      let price = block.token0Price; // take price of eth for that block
      prices.push(price);
    }
  } finally {
    return prices;
  }
}

// ---------------- historical backtest functions ----------------
 
// return an array of blocks to query (15 mins apart with a 68 block period)
export const blocksToQuery = (historicalConfig: BacktestConfig ):number[] => {
  let blocks:number[] = [];

  const { period, segmentsBack, end } = historicalConfig;

  // pick blocks (period) apart from time since latest block and no_segments length
  try {
    for (let i = end - period; i > end - segmentsBack; i = i - period) {
      blocks.push(i);
    }
  } finally {
    return blocks;
  }
}

// simple twap because getting a high/low for each 15 min block period isn't feasible
export const twap = (b0: number, b1: number): number => {
  return (b0 + b1) / 2;
}

// returns array of WETH  priced in USD
export const fetchETHPrices = async (blocksToQuery: number[]): Promise<number[]> => {

  // DAI - WETH pool for eth prices
  const wethDAI:string = "0xc3d03e4f041fd4cd388c549ee2a29a9e5075882f";
  
  // returns array of blocks with from DAI-WETH pair
  let ethPrices = await sushiData
  .timeseries({blocks: blocksToQuery, target: sushiData.exchange.pair}, {pair_address: wethDAI});

  // parses each block for only price
  return parseForPrice(ethPrices);
}

// usd price calculation (token-ETH)[block n] * (ETH-DAI)[block n] = (token-dai)[block n]
export const tokenToUSD = async (blocks: number[], ratioPrices: number[]) => {
  let prices: number[] = [];
  const ethPrice = await fetchETHPrices(blocks)

  try {
    for (let i = 0; i < blocks.length; i++) {

      // since sushiswap and uniswap return token0 price in terms of token0/token1
      // must always have historical WETH price in usd of same blocks to calculate historical prices in usd
      let price = ratioPrices[i] * ethPrice[i];
      prices.push(
        price
      )
    }
  } finally {
    return prices;
  }
}
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

// ---------------- main request function ---------------
// allows for all requests to meet rate limits (includes overheats!)

// Request queue for rate-limiting
const queue = new Queue({
  rules: {
    // coingecko api
    coingecko: {
      rate    : 10, // req
      limit   : 1,  // per sec
      priority: 1
    },
    // uniswap (thegraph)
    uniswap: {
      rate    : 60,       
      limit   : 10,      
      priority: 1
    },
    // sushiswap (thegraph)
    sushiswap: {
      rate    : 60,
      limit   : 10,
      priority: 1
    },
    // ethplorer
    ethplorer: {
      rate    : 10,
      limit   : 1,
      priority: 1
    }
  }
});

// create queued request with request-smart-balancer
export const queuedRequest = async (url: string, service: string, address: string, scheme?: string):Promise<any> => {

  // if service is being used for the backtest, pick uniswap as the service
  const exchange = service.includes('post') ? 'uniswap' : service;

  // smart-request-balancer queue wrapper for requests
  const requestToURL = async (fetchFunction: { (): Promise<any>; (): Promise<any>; (): Promise<any>; }):Promise<JSON> => {
    return queue.request(async (retry) => await fetchFunction()
    .then(response => response)
    .catch(error => {
      if (error.response.status === 429) {
        return retry(error.response.data.parameters.retry_after)
      }
      throw error;
    }), uuidv4(), exchange) // pass a unique identifier (uuid) and the api's target exchange
    .then(response => response)
    .catch(error => console.error(error));
  }

  // use POST request for backtest
  if (service === 'uniswap' || service === 'sushiswap') {
    const requestData = async () => {
      return await fetch(url, {
        method: "post",
  
        body: JSON.stringify({
          query: `{
            token(id: "${address.toLowerCase()}") {
              totalLiquidity
              txCount
            }
          }`,
        }), 
        headers: { "Content-Type": "application/json" },
      }).then((res) => res.json());
    } 
    return await requestToURL(requestData);

  } else if (service === 'uniswap-post') {

    // uniswap post request
    const requestData = async () => {
      return await fetch(url, {
        method: "post",
  
        body: JSON.stringify({
          query: scheme,
        }), 
        headers: { "Content-Type": "application/json" },
      }).then((res) => res.json());
    } 
    return await requestToURL(requestData);

  } else {

    // use GET request for assetData.ts (simple get request for any other functions)
    const requestData = async () => {
      return await fetch(
        url,
      ).then((res) => res.json());
    }
    return await requestToURL(requestData);
  }
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
  address     : string,
  period      : number, // normally 68 blocks is 15 mins
  segmentsBack: number, // should be divisible by 100 (amt of blocks to go back)
  end         : number // getLatestBlock() from web3
  
  financials : {
    liquidationIncentive: number,
    collateralFactor    : number
  }

  provider: string
}

// type for fetched data from different apis (unsorted)
export interface AssetData {
  assetAddress        : string,
  assetSymbol         : string,
  totalLiquidity      : number,
  marketCap           : number,
  audits              : boolean,
  priceChange         : number,
  fully_diluted_value : number,
  twitterFollowers    : number,
  lpAddresses         : number,
  collateralFactor    : number,
  liquidationIncentive: number,
  tokenDown           : number
}

export interface FetchedData {
  asset_market_cap   : number,
  fully_diluted_value: number,
  price_usd          : number,
  tickers            : any,
  twitter_followers  : number,
  totalLiquidity     : number,
  prices             : number[],
  ethplorer          : number
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