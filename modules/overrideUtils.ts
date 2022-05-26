import _ from "lodash";

// asset and pool overrides
import { overrides as poolOverrides } from "../overrides/poolOverrides.json";
import { overrides as assetOverrides } from "../overrides/assetOverrides.json"; 

// array of address overrides
const addressOvr = _.compact(assetOverrides.map( (override) => {
  if (override.underlying) return override 
  else return null
}));

// array of test specific overrides
const testOvr = _.compact(assetOverrides.map( (override) => {
  if (override.tests) return override
  else return null
}));

// array of pool overrides (multisig)
const poolOvr = _.compact(poolOverrides.map( (override) => {
  if (override.poolID) return override
  else return null
}));

export const fetchAddressOverride = (address: string) => {
  let override = addressOvr.find (o => o.address === address);
  return override ? override.underlying : address
}

export const fetchTestOverride =  async (address: string) => {
  let override = testOvr.find( o => o.address === address)
  if (override) {
    return await fillOverride(override.tests)
  } else {
    return await fillOverride([]);
  }
}

// return override for pool specific tests (solely multisig at the moment)
export const fetchMultisigOverride = (poolID: string) => {
  let override = poolOvr.find (o => o.poolID === poolID);

  if (override === undefined) return false
  else return true
}

const fillOverride = async (override: {test: string, section: string, value: number}[] | []) => {

  let filledOverride = {
    crash: { 
      twitter: null,
      audit: null,
      marketCap: null,
    },
    liquidity: { 
      totalLiquidity: null,
      lpAddresses: null,
    },
    volatility: { 
      marketCap: null,
      volatility: null,
    },
    historical: { 
      backtest: null
    }
  } as Override
  
  if (override) {
    override.forEach((element) => {
      filledOverride[element.test][element.section] = element.value;
    });
  }

  return filledOverride;
}

type Override = {
  crash: { 
    twitter: number | null; 
    audit: number | null; 
    marketCap: number | null; 
  }; 
  liquidity: { 
    totalLiquidity: number | null; 
    lpAddresses: number | null; 
  }; 
  volatility: { 
    marketCap: number | null; 
    volatility: number | null; 
  }; 
  historical: { 
    backtest: number | null; 
  };

  [key: string]: any
}