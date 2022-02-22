import { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchBestPair } from "../modules/fetchBestPair";
import { FetchedData } from "../modules/rssUtils";

import { queuedRequest } from "../modules/smartBalancer"

// Returns set of asset specific data points for use in scoring (reused for subsequent pools with the same asset)
// eslint-disable-next-line import/no-anonymous-default-export
export const runAssetData = async (address: string) => {

  const assetDataBlob = await fetchAssetDataBlob(address);

  const assetData = await organizeFetchedDataBlob(assetDataBlob);

  return assetData;
}

type FetchAssetDataBlobReturn = {
  coingecko : any,
  coingecko2: any,
  ethplorer : any,
  bestPair  : any,
  totalVolume: any
}

const fetchAssetDataBlob = async (
  address: string
): Promise<FetchAssetDataBlobReturn> => {

  const pairAndVolume = await fetchBestPair(address)

  const [ 
    coingecko,
    coingecko2,
    ethplorer,
    bestPair,
    totalVolume
  ] = await Promise.all(
    [
      await queuedRequest(
        `https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}`,
        `coingecko`, address),

      await queuedRequest(
        `https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}/market_chart/?vs_currency=usd&days=30`,
        `coingecko`, address),

      await queuedRequest(
        `https://api.ethplorer.io/getTokenInfo/${address}?apiKey=freekey`, 
        'ethplorer', address),
      
      // returns dex pair with highest volume in USD
      pairAndVolume.bestPair,
      pairAndVolume.totalVolume
    ]
  )

  return {
    coingecko,
    coingecko2,
    ethplorer,
    bestPair,
    totalVolume
  }
}

const organizeFetchedDataBlob = async (
  data: FetchAssetDataBlobReturn
): Promise<FetchedData | false> => {

  try {
    const {
      symbol,
      market_data: {
        market_cap              : { usd: asset_market_cap },
        current_price           : { usd: price_usd },
        fully_diluted_valuation : { usd: fully_diluted_value }
      },
      tickers,
      community_data: { twitter_followers },
    } = data.coingecko;
    
    // return prices without blocknumbers/timestamps
    const prices = data.coingecko2.prices.map( (price: number[]) => ( price[1] ));
  
    const ethplorer = data.ethplorer.holdersCount
    
    // pair address of dex with highest reserve volume
    const bestPair = data.bestPair

    // total reserve volume found in valid dex pairs
    const totalLiquidity = data.totalVolume

    return {
      symbol,
      asset_market_cap,
      fully_diluted_value,
      price_usd,
      tickers,
      twitter_followers,
      totalLiquidity,
      prices,
      ethplorer,
      bestPair
    } as FetchedData;
  } catch (e) {
    return false
  }
}