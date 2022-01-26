import { VercelRequest, VercelResponse } from "@vercel/node";

// tools and shi
import Web3    from 'web3';
import fetch   from "node-fetch";
import { max } from "mathjs";

// fuse utils
import { fetchFusePoolData, USDPricedFuseAsset } from "../modules/lib/fuse-utils/fuseUtils";
import { initFuseWithProviders, alchemyURL     } from "../modules/lib/fuse-utils/web3Providers";

// functions (by category)
import { 
  checkCoingecko, checkSushiswap, checkUniswap, checkAudits, 
  calcVolatility, 
  fetchLatestBlock, 
  calcOverall,
  ScoreBlock, 
  returnSafeTest, returnMissingTest, 
  fetchAddressOverride, fetchMultisigOverride, fetchTestOverride  
} from '../modules/rssUtils';

// types
import { AssetData, Score, FetchedData, BacktestConfig } from "../modules/rssUtils";
 
// geth (alchemy)
const fuse = initFuseWithProviders(alchemyURL);

// Web3
const web3 = new Web3(alchemyURL);

// url for making requests to the rss-module apis (requests are api's instead of modules so vercel can cache each asset for scoring subsequent pools)
const url = "https://collateral-risk.vercel.app/api";
// const url = "http://localhost:3000/api";

// eslint-disable-next-line import/no-anonymous-default-export
export default async (request: VercelRequest, response: VercelResponse) => {
  const { poolID } = request.query as { [key: string]: string };

  response.setHeader("Access-Control-Allow-Origin", "*");

  // half-day cache time
  response.setHeader("Cache-Control", "s-maxage=43200");

  let lastUpdated = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
  });

  console.log('Scoring Pool ' + poolID);

  const { overallScore, multisigScore, scores } = await scorePool(poolID);

  response.json({
    poolID,
    overallScore,
    multisigScore,
    scores,
    lastUpdated
  });
}

const scorePool = async (poolID: string) => {
  const { 
    assets, comptroller 
  } = (await fetchFusePoolData( poolID, "0x0000000000000000000000000000000000000000", fuse ))!;

  const comptrollerContract = new fuse.web3.eth.Contract(
    JSON.parse(fuse.compoundContracts["contracts/Comptroller.sol:Comptroller"].abi), comptroller
  );

  // main promise for scoring - runs once for each pool
  return await new Promise<ScoreBlock[]> (async (resolve) => {

    // await set of promises (each promise scoring an asset)
    const scores = await Promise.all( assets.map( async (asset:USDPricedFuseAsset) => {

      // hardcode asset test for ETH
      if (asset.underlyingToken === '0x0000000000000000000000000000000000000000') {
        return returnSafeTest(asset.underlyingToken, asset.underlyingSymbol);
      }

      // check override file to replace asset address (or return asset address if no override)
      const overrideAddress = fetchAddressOverride(asset.underlyingToken);

      // test address to see if token:WETH pool exists on sushi or uni
      const poolProvider = await testSources(overrideAddress);
      
      // if asset not listed on sushiswap or uniswap
      if (poolProvider === 'none') {
        return returnMissingTest(asset.underlyingToken, asset.underlyingSymbol); // returns score with asterisks as values
      } else {

        // returns data for score calculations
        const assetData: AssetData = await congregateAssetData(asset, overrideAddress, comptrollerContract, poolProvider);

        // score the asset
        const scoreBlock: ScoreBlock = await scoreAsset(overrideAddress, assetData);

        return scoreBlock;
      }
    }))
    // resolve array of ScoreBlocks (both score for the asset + info (cf, li, tokendown, etc))
    resolve(scores as ScoreBlock[]);
  })
  .then( (scores: ScoreBlock[]) => {

    // return multisig score from overrides, false if no override
    const multisigScore = fetchMultisigOverride(poolID);

    // calc max of scores
    const overallScore = calcOverall(scores);
    
    return {
      overallScore,
      multisigScore,
      scores,
    };
  })

}

// All of individual asset scoring done here
const scoreAsset = async (addressFromOverride: string, assetData: AssetData):Promise<ScoreBlock> => {

  const override = await fetchTestOverride(addressFromOverride)

  // asset data from assetData api
  const { 
    assetAddress,
    assetSymbol,
    collateralFactor, 
    liquidationIncentive, 
    totalLiquidity, 
    marketCap, 
    priceChange, 
    audits, 
    fully_diluted_value, 
    twitterFollowers, 
    lpAddresses, 
    tokenDown 
  } = assetData;

  const crash = ():number => {

    const twitterTest = override.crash.twitter;
    const auditTest   = override.crash.audit;
    const mktFDVTest   = override.crash.marketCap;

    const twitterScore   = twitterFollowers < 500 && twitterTest  ? 1 : 0;
    const auditScore     = !audits && auditTest ? 1 : 0;
    const marketCapScore = marketCap < 0.03 * fully_diluted_value && mktFDVTest ? 1 : 0;

    return twitterScore + auditScore + marketCapScore;
  }

  const liquidity = ():number => {

    const totalLiquidityTest = override.liquidity.totalLiquidity;
    const lpAddressesTest    = override.liquidity.lpAddresses;

    const totalLiquidityScore = totalLiquidity < 1000000 && totalLiquidityTest ? (totalLiquidity < 200000 ? 2 : 1) : 0;
    const lpAddressesScore    = lpAddresses < 100 && lpAddressesTest ? 1 : 0;

    return totalLiquidityScore + lpAddressesScore;
  }

  const volatility = ():number => {

    const marketCapTest  = override.volatility.marketCap;
    const volatilityTest = override.volatility.volatility;
    
    const marketCapScore = marketCap < 600000000 && marketCapTest ? (marketCap < 100000000 && marketCapTest ? (marketCap < 30000000 && marketCapTest ? 3 : 2) : 1) : 0;
    
    const doublePriceChange = priceChange * 2;
    const slippage = collateralFactor / 2;

    const volatilityScore = priceChange > .1 && doublePriceChange < (1 - collateralFactor - liquidationIncentive) && doublePriceChange < liquidationIncentive - slippage && volatilityTest ? 1 : 0;

    return marketCapScore + volatilityScore;
  }

  const historical = async ():Promise<number> => {

    const historicalTest = override.historical.backtest;
    
    const historicalScore = collateralFactor > 1 - liquidationIncentive - tokenDown && historicalTest ? 3 : 0;
    
    return historicalScore;
  }

  const score:Score = {
    address   : assetAddress,
    symbol    : assetSymbol,

    historical: await historical(),
    crash     : crash(),
    volatility: volatility(),
    liquidity : liquidity(),
    overall   : NaN
  }

  const assetInfo = {
    collateralFactor,
    tokenDown,
    marketCap,
  }

  score.overall = max(score.historical as number, score.crash as number, score.volatility as number, score.liquidity as number)

  return {
    score,
    assetInfo
  } as ScoreBlock;
}

//  and only return the variables needed for risk calculation
const congregateAssetData = async (
  asset: USDPricedFuseAsset,
  addressFromOverride: string,
  comptroller   : any,
  pairProvider  : string
):Promise<AssetData> => {

  const assetAddress = asset.underlyingToken;
  const assetSymbol  = asset.underlyingSymbol;

  const fetchedData: FetchedData = await assetDataFetch(addressFromOverride);

  const [
    audits,
    priceChange,
    liquidationIncentive,
    totalLiquidity,
    marketCap,
    fully_diluted_value,
    twitterFollowers,
    lpAddresses,
    collateralFactor
  ] = await Promise.all([
    
    checkAudits(fetchedData.tickers),
    calcVolatility(fetchedData.prices),

    ((await comptroller.methods
        .liquidationIncentiveMantissa().call()) / 1e18) - 1,

    fetchedData.totalLiquidity,
    fetchedData.asset_market_cap,
    fetchedData.fully_diluted_value,
    fetchedData.twitter_followers,
    fetchedData.ethplorer,

    (asset.collateralFactor / 1e18)
  ])

  // make request to historical backtest
  const tokenDown: number = await historicalFetch(addressFromOverride, pairProvider, {liquidationIncentive, collateralFactor})
    .then( (data) => data.tokenDown);

  return {
    assetAddress,    
    assetSymbol,
    audits,
    priceChange,
    liquidationIncentive,
    totalLiquidity,
    marketCap,
    fully_diluted_value,
    twitterFollowers,
    lpAddresses,
    collateralFactor,
    tokenDown
  }
}

// make get request to assetData api (separate api for cacheing)
const assetDataFetch = async (assetAddress: string):Promise<FetchedData> => {
  return await fetch(url + '/assetData?address=' + assetAddress).then(res => res.json()) as FetchedData;
}

// fetch data from sushiswap or uniswap (specified in pair)
const historicalFetch = async (assetAddress: string, pairProvider: string, poolData: {liquidationIncentive: number, collateralFactor: number}):Promise<{ tokenDown: number }> => {
  const weekOfBlocks = 6500;

  // TODO: replace with normal get request, faster
  const config: BacktestConfig = {
    address      : assetAddress,
    period       : 68, // roughly 15 mins
    segmentsBack : weekOfBlocks, // one week of blocks
    end          : await fetchLatestBlock(web3),
    financials   : poolData,
    provider     : pairProvider
  }

  return await fetch(url + "/historical", {
    method : "POST",
    headers: {
      'Content-type': 'application/json'
    },
    body   : JSON.stringify(config)
  })
  .then((res) => res.json())
}

// test 
const testSources = async (address: string): Promise<string> => {
  const coingecko = await checkCoingecko(address);
  const sushiswap = await checkSushiswap(address);
  const uniswap   = await checkUniswap(address);

  if (address === "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0") {
    console.log('-----')
    console.log(' address:', address)
    console.log( "coingecko:", coingecko)
    console.log( "sushiswap:", sushiswap)
    console.log( "uniswap:", uniswap)
    console.log('-----')
  }

  if (coingecko && (sushiswap || uniswap)) {
    return uniswap ? 'uniswap' : 'sushiswap';
  } else {
    console.log('asset not listed on any pool provider');
    return 'none'
  }
}