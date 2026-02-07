/**
 * Simple in-memory rate limiter
 * In production, consider using Redis for distributed systems
 */
class RateLimiter {
  constructor() {
    this.requests = new Map();

    // Clean up old entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.requests.entries()) {
        if (now - data.firstRequest > 15 * 60 * 1000) {
          this.requests.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Check if request is allowed
   * @param {string} key - Identifier (e.g., email address)
   * @param {number} maxRequests - Max requests allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {boolean} - True if request is allowed
   */
  isAllowed(key, maxRequests = 3, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const data = this.requests.get(key);

    if (!data) {
      // First request
      this.requests.set(key, {
        count: 1,
        firstRequest: now
      });
      return true;
    }

    // Check if window has expired
    if (now - data.firstRequest > windowMs) {
      // Reset window
      this.requests.set(key, {
        count: 1,
        firstRequest: now
      });
      return true;
    }

    // Within window - check count
    if (data.count >= maxRequests) {
      return false;
    }

    // Increment count
    data.count++;
    return true;
  }

  /**
   * Get remaining requests for a key
   * @param {string} key - Identifier
   * @param {number} maxRequests - Max requests allowed
   * @returns {number} - Remaining requests
   */
  getRemaining(key, maxRequests = 3) {
    const data = this.requests.get(key);
    if (!data) return maxRequests;
    return Math.max(0, maxRequests - data.count);
  }
}

module.exports = new RateLimiter();
