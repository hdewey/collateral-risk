import sushiData from '@sushiswap/sushi-data';

import uniData from 'uni-data';


import { SushiBlock as Block } from './rssUtils';

export const sushiswapQuery = async(blocks: number[], address: string): Promise<number[]> => {

  // returns an array of SushiBlocks for each block specified
  const tokenPrices:Block[] = await sushiData
    .timeseries({blocks: blocks, target: sushiData.exchange.pair}, {pair_address: address});

  // create array of soley price data
  const parsedPrices = tokenPrices.map( (sushiBlock: Block) => {
    switch (sushiBlock.data.token1.symbol.toLowerCase()) {
      case 'weth':
        return sushiBlock.data.token1Price;
      default:
        return sushiBlock.data.token0Price;
    }
  })

  return parsedPrices
}

export const uniswapQuery = async (blocks: number[], address: string): Promise<number[]> => {

  // returns an array of SushiBlocks for each block specified
  const tokenPrices:Block[] = await uniData
    .timeseries({blocks: blocks, target: uniData.exchange.pair}, {pair_address: address});

  // create array of soley price data
  const parsedPrices = tokenPrices.map( (sushiBlock: Block) => {
    switch (sushiBlock.data.token1.symbol.toLowerCase()) {
      case 'weth':
        return sushiBlock.data.token1Price;
      default:
        return sushiBlock.data.token0Price;
    }
  })

  return parsedPrices
}