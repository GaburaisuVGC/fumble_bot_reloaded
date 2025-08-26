/**
 * Configuration for Pokemon Showdown API requests.
 */
export default {
    MAX_RETRIES: 5,              // Maximum number of retries per request
    RETRY_DELAY: 2000,           // Initial delay between retries (ms)
    RATE_LIMIT_DELAY: 1000,      // Delay between each request (ms)
    BATCH_SIZE: 3,               // Maximum number of simultaneous requests
    TIMEOUT: 10000,              // Request timeout (ms)
    MAX_RETRY_DELAY: 30000,      // Maximum delay between retries (ms)
    FORMAT: 'gen9vgc2025reghbo3' // Pokemon Showdown format to track
};