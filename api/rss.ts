import { VercelRequest, VercelResponse } from "@vercel/node";

// tools and shi
import Web3    from 'web3';
import { max } from "mathjs";

// fuse pools and provider
import { fetchFusePoolData, USDPricedFuseAsset } from "../modules/fuse/fuse-utils/fuseUtils";
import { initFuseWithProviders, alchemyURL     } from "../modules/fuse/fuse-utils/web3Providers";

import { 
  checkAudits, 
  calcVolatility, 
  fetchLatestBlock, 
  ScoreSet, 
  returnSafeTest, returnMissingTest, 
} from '../modules/rssUtils';

import {
  fetchAddressOverride, 
  fetchMultisigOverride, 
  fetchTestOverride  
} from '../modules/overrideUtils';

import { 
  AssetData,
  Score, 
  FetchedData, 
  BacktestConfig 
} from "../modules/rssUtils";

import { Contract } from "web3-eth-contract";

import { runHistoricalTest } from "./historical";
import { runAssetData } from "./assetData";

import convertScore from "../modules/convertScore";

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
 
  response.json( convertScore({
    poolID,
    overall,
    multisig,
    scores,
    lastUpdated
  }));
}

const scoreAssetFromAddress = async (
  _address: string, 
  symbol  : string, // TODO: Replace
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
const scoreAsset = async (assetData: AssetData):Promise<ScoreSet> => {

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

  const debug = true;

  const override = await fetchTestOverride(address)

  const crash = ():number => {

    const twitterOverride = override?.crash?.twitter;
    const auditOverride   = override?.crash?.audit;
    const mktFDVOverride  = override?.crash?.marketCap;

    const twitterScore   = twitterOverride ? twitterOverride : (twitterFollowers < 500 ? 1 : 0)
    const auditScore     = auditOverride ? auditOverride : (!audits ? 1 : 0)
    const marketCapScore = mktFDVOverride ? mktFDVOverride : (marketCap < 0.03 * fully_diluted_value ? 1 : 0)

    if (debug) {
      console.log({
        crash: {
          twitterScore,
          auditScore,
          marketCapScore
        }}
      )
    }

    return twitterScore + auditScore + marketCapScore;
  }

  const liquidity = ():number => {

    const totalLiquidityOverride = override?.liquidity?.totalLiquidity;
    const lpAddressesOverride    = override?.liquidity?.lpAddresses;

    const tl1 = totalLiquidity < 1000000 ? 1 : 0;
    const tl2 = totalLiquidity < 200000 ? 1 : 0;

    const lp = lpAddresses < 100 ? 1 : 0;

    const totalLiquidityScore =  totalLiquidityOverride !== null ? totalLiquidityOverride : tl1 + tl2;
    const lpAddressesScore    =  lpAddressesOverride !== null ? lpAddressesOverride : lp;

    if (debug) {
      console.log({
        liquidity: {
          totalLiquidityScore,
          lpAddressesScore,
        }}
      )
    }

    return totalLiquidityScore + lpAddressesScore;
  }

  const volatility = ():number => {

    const marketCapOverride  = override?.volatility?.marketCap;
    const volatilityOverride = override?.volatility?.volatility;

    const m1 = marketCap < 300000000 ? 1 : 0;
    const m2 = marketCap < 50000000 ? 1 : 0;
    const m3 = marketCap < 15000000 ? 1 : 0;

    

    const doublePriceChange = priceChange * 2;
    const slippage = collateralFactor / 2;

    const v1 = priceChange > slippage ? 1 : 0;
    const v2 = doublePriceChange > (1 - collateralFactor - liquidationIncentive) ? 1 : 0

    const volatilityScore: number = volatilityOverride !== null ? volatilityOverride : v1 + v2;
    const marketCapScore: number = marketCapOverride !== null ? marketCapOverride : m1 + m2 + m3;

    if (debug) {
      console.log({
        volatility: {
          symbol,
          marketCapOverride,
          marketCapScore,
          volatilityScore,
        }}
      )
    }

    return marketCapScore + volatilityScore;
  }

  const historical = async ():Promise<number> => {

    const historicalOverride = override?.historical?.backtest;

    if (tokenDown) {
      const hs = collateralFactor > 1 - liquidationIncentive - tokenDown ? 1 : 0;
      const historicalScore =  historicalOverride !== null ? historicalOverride : hs;

      if (debug) {
        console.log({
          historical: {
            hs
          }}
        )
      }
    
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
  } as ScoreSet;
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

// calculate overall score from assets
const calcOverall = (scoreBlocks: ScoreSet[]):number|string => {

    // return only score from a ScoreBlock
  const scores:Score[] = scoreBlocks.map( (scoreBlock) => scoreBlock.score);

  // throw out assets that weren't scored
  const filtered:Score[] = scores.filter(function(value){ 
    return value.overall !== '*';
  });

  const overall:number[] = filtered.map( (score: Score) => {
    return score.overall as number;
  })

  if (overall.length > 0) {
    return max(...overall)
  } else {
    return "*";
  }
}
