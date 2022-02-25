// sushiswap & uniswap objects for deterministic pairID creation 
import { 
  ChainId as sushi_ChainId, 
  Token   as sushi_Token, 
  Pair    as sushi_Pair
} from '@sushiswap/sdk';

import { 
  ChainId as uni_ChainId, 
  Token   as uni_Token, 
  Pair    as uni_Pair 
} from '@uniswap/sdk';

import sushiData from '@sushiswap/sushi-data';
import uniData   from 'uni-data';
import _ from 'lodash';

const checksum = require('eth-checksum');

// find pair on dex with highest volume
export const fetchBestPair = async (address: string) => {

  const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const dai  = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  const baseTokens = [ weth, dai, usdc ];

  const { foundUniswapPools, totalUniswapVolume } = await queryUniswapPairs(address, baseTokens);
  const { foundSushiswapPools, totalSushiswapVolume } = await querySushiswapPairs(address, baseTokens);

  const pairs = _.flatten( [ foundUniswapPools, foundSushiswapPools] );

  const bestPair = _.maxBy( pairs, (p) => { return p.volume } )

  const totalVolume = totalUniswapVolume + totalSushiswapVolume;

  return {
    bestPair,
    totalVolume
  };

}

const queryUniswapPairs = async (address: string, baseTokens: string[]) => {

  let totalUniswapVolume = 0;

  const pools = await Promise.all(baseTokens.map( async (baseToken: string) => {
    if ( address.toLowerCase() == baseToken.toLowerCase() ) return null

    const pairAddress = await createUniswapPairID(address, baseToken);
    const pool = await queryUniswapPool(pairAddress);

    if ( pool ) {
      const volume = pool.reserveUSD;
      const exchange = 'uniswap';

      totalUniswapVolume = totalUniswapVolume + volume

      return {
        pairAddress,
        volume,
        exchange
      }
    } else return null
  }))

  const foundUniswapPools = _.compact(pools)

  return {
    foundUniswapPools,
    totalUniswapVolume
  }
}

const querySushiswapPairs = async (address: string, baseTokens: string[]) => {

  let totalSushiswapVolume = 0;

  const pools = await Promise.all(baseTokens.map( async (baseToken: string) => {
    if ( address.toLowerCase() == baseToken.toLowerCase() ) return null

    const pairAddress = await createSushiswapPairID(address, baseToken);
    const pool = await querySushiswapPool(pairAddress);

    if ( pool ) {
      const volume = pool.reserveUSD;
      const exchange = 'sushiswap';

      totalSushiswapVolume = totalSushiswapVolume + volume

      return {
        pairAddress,
        volume,
        exchange
      }
    } else return null
  }))

  const foundSushiswapPools = _.compact(pools)

  return {
    foundSushiswapPools,
    totalSushiswapVolume
  }
}

export const queryUniswapPool = async (address: string) => {
  try {
    return await uniData.exchange.pair({pair_address: address})
  } catch {
    return false
  } 
}

export const querySushiswapPool = async (address: string) => {
  try {
    return await sushiData.exchange.pair({pair_address: address})
  } catch {
    return false
  }
}

// calculate hash of token-WETH with sushiswap factory
const createSushiswapPairID = async (address: string, base: string):Promise<string> => {

  const token0 = new sushi_Token(sushi_ChainId.MAINNET, checksum.encode(address), 18);
  const token1 = new sushi_Token(sushi_ChainId.MAINNET, checksum.encode(base), 18);
  const pair   = sushi_Pair.getAddress(token0, token1);

  return pair.toLowerCase();
}

// calculate hash of token-WETH with uniswap factory
const createUniswapPairID = async (address: string, base: string):Promise<string> => {

  const token0 = new uni_Token(uni_ChainId.MAINNET, checksum.encode(address), 18);
  const token1 = new uni_Token(uni_ChainId.MAINNET, checksum.encode(base), 18);
  const pair   = uni_Pair.getAddress(token0, token1);

  return pair.toLowerCase();
}
