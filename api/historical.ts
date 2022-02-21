import { VercelRequest, VercelResponse } from "@vercel/node";

// types
import { BacktestConfig, PriceSet, tokenToUSD } from "../modules/rssUtils";

// functions
import { twap, blocksToQuery } from '../modules/rssUtils';

// query sushiswap
import sushiswap from "../modules/fetch/sushiFetch";
import uniswap   from "../modules/fetch/uniFetch";
import { querySushiswapPool, queryUniswapPool } from "../modules/fetchBestPair";
import { Pair } from "@sushiswap/sdk";

// cache historical data on vercel for each asset
// eslint-disable-next-line import/no-anonymous-default-export
export default async (request: VercelRequest, response: VercelResponse) => {

  // financials = liquidation incentive and collateral factor (used for calculating tokenDown)
  const exchangeParameters = request.body as BacktestConfig;

  response.setHeader("Access-Control-Allow-Origin", "*");
  // half-day cache time DOES NOT CACHE WITH POST REQ
  response.setHeader("Cache-Control", "s-maxage=43200");

  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Methods', 'POST');

  const priceData = await queryExchange(exchangeParameters);

  if (priceData) {
    const tokenDown: number   = await calcTokenDown(priceData, exchangeParameters.financials);

    // send token down
    response.json(
      { tokenDown }
    );

  }
}

// calculate token down given a set of prices
const calcTokenDown = async (priceSet: PriceSet, financials: {liquidationIncentive: number, collateralFactor: number}): Promise<number> => {

  const { prices } = priceSet

  const li = parseFloat(financials.liquidationIncentive.toFixed(4));

  // need a more adaptive system for calculating slippage :/
  const slippage = financials.collateralFactor / 8;

  let tokenDowns:number[] = [];

  try {

    for (let i = 0; i < prices.length - 1; i++) {

      for (let x = 0; x + i < prices.length - 1; x++) {

        // block to calculate change from beginning of liquidation period to successful liquidation
        let blockOriginal = prices[i];

        let block0 = prices[i + x];
        let block1 = prices[i + x + 1];

        let currentTWAP = twap(block0, block1);

        if (li > ((currentTWAP - block1) / currentTWAP) + slippage) {
          // liquidation successful
          
          // token down = (beginning of liquidation price - period of liquidation average price) / beginning of liquidation price
          let td = Math.abs((blockOriginal - currentTWAP) / blockOriginal);
          
          // push token down to array of all token downs
          tokenDowns.push(td);
          break;
        } else if ( x + i > prices.length) {
          // liquidation never feasible
          break;
        } else {
          // debug
          // console.log(`block ${i} cannot be liquidated at period ${x}`)
        }
      }
    }
  } finally {
    // max array of token downs
    return Math.max(...tokenDowns);
  }
}

const queryExchange = async (exchangeParameters: BacktestConfig) => {

  const { pair } = exchangeParameters;

  const pairAddress = pair.pairAddress;

  const blocks:number[] = blocksToQuery(exchangeParameters);

  const prices = async () => {
    switch (pair.exchange) {
      case "uniswap":
        return await uniswap( blocks, pairAddress)
      case "sushiswap":
        return await sushiswap( blocks, pairAddress)
      default: 
        return null
    }
  }

  const dexPrices = await prices();

  if (dexPrices) {

    const pricesUSD = await tokenToUSD(blocks, dexPrices);

    return {
      block: {
        start: blocks[0], 
        end: blocks[blocks.length - 1] 
      },
      prices: pricesUSD
    } as PriceSet
  } else {
    return false
  }
}