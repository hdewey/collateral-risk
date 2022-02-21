import sushiData from '@sushiswap/sushi-data';

import { SushiBlock } from '../rssUtils';

// eslint-disable-next-line import/no-anonymous-default-export
export default async(blocks: number[], address: string): Promise<number[]> => {

  // returns an array of SushiBlocks for each block specified
  const tokenPrices:SushiBlock[] = await sushiData
    .timeseries({blocks: blocks, target: sushiData.exchange.pair}, {pair_address: address});

  // create array of soley price data
  const parsedPrices = tokenPrices.map( (sushiBlock: SushiBlock) => {
    switch (sushiBlock.data.token1.symbol.toLowerCase()) {
      case 'weth':
        return sushiBlock.data.token1Price;
      default:
        return sushiBlock.data.token0Price;
    }
  })

  return parsedPrices
}