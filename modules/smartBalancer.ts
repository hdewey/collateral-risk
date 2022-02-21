
// keep requests under rate-limits
import Queue from 'smart-request-balancer';

// using uuid as unique request identifier for queued request function
import { v4 as uuidv4 } from 'uuid';

// ---------------- main request function ---------------
// allows for all requests to meet rate limits (includes overheats!)

// Request queue for rate-limiting
const queue = new Queue({
  rules: {
    // coingecko api
    coingecko: {
      rate    : 10, // req
      limit   : 1,  // per sec
      priority: 1
    },
    // uniswap (thegraph)
    uniswap: {
      rate    : 60,       
      limit   : 10,
      priority: 1
    },
    // sushiswap (thegraph)
    sushiswap: {
      rate    : 60,
      limit   : 10,
      priority: 1
    },
    // ethplorer
    ethplorer: {
      rate    : 10,
      limit   : 1,
      priority: 1
    }
  }
});

// create queued request with request-smart-balancer
export const queuedRequest = async (url: string, service: string, address: string, scheme?: string):Promise<any> => {

  // if service is being used for the backtest, pick uniswap as the service

  // smart-request-balancer queue wrapper for requests
  const queueFetch = async (fetchFunction: { (): Promise<any>; (): Promise<any>; (): Promise<any>; }):Promise<JSON> => {
    return queue.request(async (retry) => await fetchFunction()
    .then(response => response)
    .catch(error => {
      if (error.response.status === 429) {
        return retry(error.response.data.parameters.retry_after)
      }
      throw error;
    }), uuidv4(), service) // pass a unique identifier (uuid) and the api's target exchange
    .then(response => response)
    .catch(error => console.error(error));
  }

  // use POST request for backtest
  if (service === 'uniswap' || service === 'sushiswap') {
    const requestData = async () => {
      return await fetch(url, {
        method: "post",
  
        body: JSON.stringify({
          query: `{
            token(id: "${address.toLowerCase()}") {
              totalLiquidity
              txCount
            }
          }`,
        }), 
        headers: { "Content-Type": "application/json" },
      }).then((res) => res.json());
    } 
    return await queueFetch(requestData);
  } else {

    // use GET request for assetData.ts (simple get request for any other functions)
    const requestData = async () => {
      return await fetch(
        url,
      ).then((res) => res.json());
    }
    return await queueFetch(requestData);
  }
}