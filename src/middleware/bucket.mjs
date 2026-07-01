/*
The token bucket strategy consists in assigning each client a bucket that fills with tokens at a steady rate over time (e.g., 10 tokens per second).

Each request the client makes consumes one token from the bucket. If the bucket has tokens available, the request is allowed; if it’s empty, the request is blocked until new tokens are added.

For example, a token bucket of 60 tokens refilled at a rate of 1 token per second means a client can make short bursts of up to 60 requests at once, but after that, they will only be able to send 1 new request per second as the bucket refills.
*/
export function linearRefillFactory(tokenPerInterval, IntervalSec) {
  return (lastRequest,rateLimitOK) =>{
   const currentDelta = Date.now()-lastRequest
   return Math.floor(currentDelta/(IntervalSec*1000))*tokenPerInterval;
  }
}

export function tokenBucket(refillFunc, capacity) {
  const store = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let bucket = store.get(key);

    if (!bucket) {
      // Create a new bucket filled at capacity
      bucket = {
        tokens: capacity,
        lastReq: now,
        rateLimitOK: NaN
      };
      store.set(key, bucket);
    }

    bucket.tokens = Math.min(capacity, bucket.tokens + refillFunc(lastReq, rateLimitOK))
    bucket.lastReq = now

    // Reject the request if the bucket is empty
    if (bucket.tokens < 1) {
      return res.status(429).json({ error: 'Too Many Requests' });
    }
    else{
      bucket.rateLimitOK = now
    }
  
    // Decrement the amount of tokens by 1
    bucket.tokens -= 1;

    // Allow and forward the request to the next middleware
    next();
  };
}