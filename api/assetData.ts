import { VercelRequest, VercelResponse } from "@vercel/node";

import { calcTotalLiquidity, FetchedData, queuedRequest } from "../modules/rssUtils";

// Returns set of asset specific data points for use in scoring (reused for subsequent pools with the same asset)
// eslint-disable-next-line import/no-anonymous-default-export
export default async (request: VercelRequest, response: VercelResponse) => {
  const { address } = request.query;

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "max-age=2592000, s-maxage=2592000");

  const assetData = await fetchAssetData(address);

  response.json(
    assetData
  )
}

const sources = [
  {
    name: "coingecko",
    url : ""
  }
]

// fetch data points from variety of sources for specific address
const fetchAssetData = async (address):Promise<FetchedData> => {
  
  const coingeckoRequest = async () => {
    let data:any = await queuedRequest(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}`, `coingecko`, address)

    const {
      market_data: {
        market_cap              : { usd: asset_market_cap },
        current_price           : { usd: price_usd },
        fully_diluted_valuation : { usd: fully_diluted_value }
      },
      tickers,
      community_data: { twitter_followers },
    } = data;

    return { asset_market_cap, price_usd, fully_diluted_value, tickers, twitter_followers }
  }

  const uniswapRequest = async () => {
    let data:any = await queuedRequest(`https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2`, `uniswap`, address)
    .then( (res) => {
      return parseInt(res.data.token.totalLiquidity);
    })
    .catch(() => false)
    return data;
  }

  const sushiswapRequest = async () => {
    let data:any = await queuedRequest(`https://api.thegraph.com/subgraphs/name/zippoxer/sushiswap-subgraph-fork`, `sushiswap`, address)
    .then( (res) => {
      return parseInt(res.data.token.totalLiquidity);
    })
    .catch(() => false)
    return data;
  }

  const pricesRequest = async () => {
    let data:any = await queuedRequest(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}/market_chart/?vs_currency=usd&days=0.25`, `coingecko`, address);
    const prices = data.prices.map( (price) => {
      return price[1];
    })
    return prices;
  }

  const ethplorerRequest = async () => {
    let data:any = await queuedRequest(`https://api.ethplorer.io/getTokenInfo/${address}?apiKey=freekey`, 'ethplorer', address).then(res => res.holdersCount);
    return data;
  }
 
  const { 
    asset_market_cap,
    fully_diluted_value,
    price_usd,
    tickers,
    twitter_followers,
  } = await coingeckoRequest();
    
  const uniData   = await uniswapRequest();
  const sushiData = await sushiswapRequest();
  const prices    = await pricesRequest();
  const ethplorer = await ethplorerRequest();

  const assetCurrentPrice = prices[0];

  const totalLiquidity = await calcTotalLiquidity(sushiData, uniData, assetCurrentPrice);

  return {
    asset_market_cap,
    fully_diluted_value,
    price_usd,
    tickers,
    twitter_followers,
    totalLiquidity,
    prices,
    ethplorer
  } as FetchedData;
}