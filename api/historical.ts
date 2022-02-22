import { VercelRequest, VercelResponse } from "@vercel/node";

// types
import { BacktestConfig, calcVolatility, PriceSet, SushiBlock } from "../modules/rssUtils";

// functions

// query sushiswap
import sushiswap from "../modules/fetch/sushiFetch";
import uniswap   from "../modules/fetch/uniFetch";
import sushiData from "@sushiswap/sushi-data";

// cache historical data on vercel for each asset
// eslint-disable-next-line import/no-anonymous-default-export
export const runHistoricalTest = async (exchangeParameters: BacktestConfig) => {

  const { exchange, pairAddress } = exchangeParameters.pair


  const blocks = blocksToQuery(exchangeParameters);

  const priceData = await historicalQuery(pairAddress, exchange, blocks);

  if (priceData) {
    const tokenDown = await calcTokenDown(priceData, exchangeParameters.financials);

    // send token down
   return tokenDown

  } else {
    const tokenDown = 0;
    return tokenDown
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

// fetch historical prices and determine if historical test should run
const historicalQuery = async (pairAddress: string, exchange: string, blocks: number[]) => {

  const prices = async () => {
    switch (exchange) {
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
    const volatility = calcVolatility(dexPrices)

    if ( volatility < 0.01 ) {
      return false; 
    } else {
      const pricesUSD = await tokenToUSD(blocks, dexPrices);

      return {
        block: {
          start: blocks[0], 
          end: blocks[blocks.length - 1] 
        },
        prices: pricesUSD
      } as PriceSet
    }
  } else return false
}

// return an array of blocks to query (15 mins apart with a 68 block period)
export const blocksToQuery = ( { period, segmentsBack, end } ):number[] => {
  let blocks:number[] = [];

  // pick blocks (period) apart from time since latest block and no_segments length
  try {
    for (let i = end - period; i > end - segmentsBack; i = i - period) {
      blocks.push(i);
    }
  } finally {
    return blocks;
  }
}

export const twap = (b0: number, b1: number): number => {
  return (b0 + b1) / 2;
}

// historical prices of eth
export const fetchETHPrices = async (blocksToQuery: number[]): Promise<number[]> => {

  // USDC - WETH pool for eth prices
  const wethUSDC = "0x397ff1542f962076d0bfe58ea045ffa2d347aca0";
  
  // returns array of blocks with from DAI-WETH pair
  let ethPrices = await sushiData
    .timeseries({blocks: blocksToQuery, target: sushiData.exchange.pair}, {pair_address: wethUSDC});

  // parses each block for only price
  return parseForPrice(ethPrices);
}

// usd price calculation (token-ETH)[block n] * (ETH-USD)[block n] = (token-USD)[block n]
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
