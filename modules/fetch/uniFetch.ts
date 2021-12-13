// homemode fork of @sushiswap/sushi-data, forked to query uniswap subgraph
import uniData from 'uni-data';

// functions
import { uniswapFetchPairID } from '../rssUtils';

// types
import { SushiBlock as UniBlock } from '../rssUtils';

// eslint-disable-next-line import/no-anonymous-default-export
export default async(blocks: number[], address: string): Promise<number[]> => {

  const pairID = await uniswapFetchPairID(address);

  // returns an array of SushiBlocks for each block specified
  const tokenPrices:UniBlock[] = await uniData
    .timeseries({blocks: blocks, target: uniData.exchange.pair}, {pair_address: pairID});

  // create array of soley price data
  const parsedPrices = tokenPrices.map( (sushiBlock: UniBlock) => {
    switch (sushiBlock.data.token1.symbol.toLowerCase()) {
      case 'weth':
        return sushiBlock.data.token1Price;
      default:
        return sushiBlock.data.token0Price;
    }
  })

  return parsedPrices
}