import { VercelRequest, VercelResponse } from "@vercel/node";

// tools and shi
import Web3    from 'web3';
import fetch   from "node-fetch";
import { max } from "mathjs";

// fuse pools and provider
import { fetchFusePoolData, USDPricedFuseAsset } from "../modules/lib/fuse-utils/fuseUtils";
import { initFuseWithProviders, alchemyURL     } from "../modules/lib/fuse-utils/web3Providers";

// functions (by category)
import { 
  checkAudits, 
  calcVolatility, 
  fetchLatestBlock, 
  calcOverall,
  ScoreBlock, 
  returnSafeTest, returnMissingTest, 
  fetchAddressOverride, fetchMultisigOverride, fetchTestOverride  
} from '../modules/rssUtils';

// types
import { 
  AssetData,
  Score, 
  FetchedData, 
  BacktestConfig 
} from "../modules/rssUtils";

import { Contract } from "web3-eth-contract";
import { runHistoricalTest } from "./historical";
import { runAssetData } from "./assetData";

// instantiate fuse for a pool's assets and liquidation incentive
const fuse = initFuseWithProviders(alchemyURL);

// Web3
const web3 = new Web3(alchemyURL);

export default async (request: VercelRequest, response: VercelResponse) => {

  const { poolID } = request.query as { [key: string]: string };

  response.setHeader("Access-Control-Allow-Origin", "*");

  // half-day cache time
  response.setHeader("Cache-Control", "s-maxage=43200");

  let lastUpdated = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
  });

  console.log('Scoring Pool ' + poolID);

  const { 
    overall,
    multisig, 
    scores
  } = await scorePoolwithPoolID(poolID);
 
  response.json({
    poolID,
    overall,
    multisig,
    scores,
    lastUpdated
  });
}

const scoreAssetFromAddress = async (
  _address: string, 
  symbol  : string,
  config?: {
    liquidationIncentive: number, // default liquidation incentive to 15%
    collateralFactor    : number  // default collateral factor to 75%
  }
) => {
  // default liquidation incentive to 15%
  const li = config ? config.liquidationIncentive : 0.15;

  // default collateral factor to 75%
  const cf = config ? config.collateralFactor : 0.75;

  const address = fetchAddressOverride(_address);

  if (address === '0x0000000000000000000000000000000000000000') {
    return returnSafeTest(address, 'ETH');
  }

  const assetData = await fetchDataSources(address, li, cf);

  if (assetData) {

    return await scoreAsset(assetData);

  } else return returnMissingTest(_address, symbol)

}


const scorePoolwithPoolID = async (
  poolID: string
) => {

  const { 
    assets, comptroller 
  } = (await fetchFusePoolData( poolID, "0x0000000000000000000000000000000000000000", fuse ))!;

  const comptrollerContract = new fuse.web3.eth.Contract(
    JSON.parse(fuse.compoundContracts["contracts/Comptroller.sol:Comptroller"].abi), comptroller
  );

  const scores = await Promise.all( assets.map( async (asset: USDPricedFuseAsset) => {

    const address = asset.underlyingToken;
    const symbol  = asset.underlyingSymbol;

    const collateralFactor = (asset.collateralFactor / 1e18);
    const liquidationIncentive = await fetchLiquidationIncentive(comptrollerContract);

    const config = {
      collateralFactor,
      liquidationIncentive
    }
    
    const score = await scoreAssetFromAddress( address, symbol, config );

    return score;
  }))

  const overall = calcOverall(scores);

  const multisig = fetchMultisigOverride(poolID);

  console.log(`scored pool ${poolID} (overall: ${overall})`);

  return {
    overall,
    multisig,
    scores
  }
}

const fetchLiquidationIncentive = async (comptrollerContract: Contract) => {
  const liquidationIncentive = ((await comptrollerContract.methods
    .liquidationIncentiveMantissa().call()) / 1e18) - 1;

  return liquidationIncentive
}

const fetchDataSources = async (address: string, li: number, cf: number): Promise<AssetData | false> => {

  const fetchedData = await fetchAssetData(address);

  if (!fetchedData) return false;

  // make request to historical backtest
  const tokenDown = await fetchHistoricalSimulation(fetchedData.bestPair, li, cf);

  const [
    symbol,
    audits,
    priceChange,
    totalLiquidity,
    marketCap,
    fully_diluted_value,
    twitterFollowers,
    lpAddresses,
  ] = await Promise.all([
    fetchedData.symbol,
    
    checkAudits(fetchedData.tickers),
    calcVolatility(fetchedData.prices),

    fetchedData.totalLiquidity,
    fetchedData.asset_market_cap,
    fetchedData.fully_diluted_value,
    fetchedData.twitter_followers,
    fetchedData.ethplorer,
  ])

  const liquidationIncentive = li;
  const collateralFactor     = cf;

  return {
    address,
    liquidationIncentive,
    collateralFactor,
    symbol,
    totalLiquidity,
    marketCap,
    audits,
    priceChange,
    fully_diluted_value,
    twitterFollowers,
    lpAddresses,
    tokenDown
  }  
}

// All of individual asset scoring done here
const scoreAsset = async (assetData: AssetData):Promise<ScoreBlock> => {

  // asset data from assetData api
  const { 
    address,
    symbol,
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

  const override = await fetchTestOverride(address)

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

    if (tokenDown) {
      const historicalScore = collateralFactor > 1 - liquidationIncentive - tokenDown && historicalTest ? 1 : 0;
    
      return historicalScore;
    } else {
      return 0
    }
  }

  const historicalScore = await historical();
  const crashScore  = crash();
  const volatilityScore = volatility();
  const liquidityScore = liquidity();

  const overallScore = max(
    historicalScore,
    crashScore,
    volatilityScore,
    liquidityScore
  )

  const score: Score = {
    address,
    symbol,

    historical: historicalScore,
    crash     : crashScore,
    volatility: volatilityScore,
    liquidity : liquidityScore,
    overall   : overallScore
  }

  const assetInfo = {
    collateralFactor,
    tokenDown,
    marketCap,
  }

  return {
    score,
    assetInfo
  } as ScoreBlock;
}

// make get request to assetData api (separate api for cacheing)
const fetchAssetData = async (address: string):Promise<FetchedData | false> => {
  try {
    return await runAssetData(address);
  } catch (e) {
    return false
  }
}

// fetch data from sushiswap or uniswap (specified in pair)
const fetchHistoricalSimulation = async (
  pair : any, 
  liquidationIncentive: number,
  collateralFactor: number
):Promise<number | null> => {
  const weekOfBlocks = 6500;

  const config: BacktestConfig = {
    period       : 68,           // roughly 15 mins
    segmentsBack : weekOfBlocks, // one week of blocks
    end          : await fetchLatestBlock(web3),
    financials   : { liquidationIncentive, collateralFactor },
    pair         : pair
  }

  const tokenDown = await runHistoricalTest(config);

  return tokenDown
}