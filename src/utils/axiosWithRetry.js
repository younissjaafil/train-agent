const axios = require("axios");
const axiosRetry = require("axios-retry").default;

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000, // exponential: 1s, 2s, 3s
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.response?.status >= 500
    );
  },
});

module.exports = axios;
