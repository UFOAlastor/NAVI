// 缓存管理类
class CacheManager {
  constructor(ttl = 3600000) { // 默认缓存1小时
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  clear() {
    this.cache.clear();
  }
}

// 限流器类
class RateLimiter {
  constructor(maxRequests, timeWindow) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }

  async waitForSlot() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.push(now);
  }
}

// 重试管理器类
class RetryManager {
  constructor(maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
  }

  async execute(operation) {
    let lastError;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (this.shouldRetry(error)) {
          const delay = this.calculateDelay(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  shouldRetry(error) {
    // 根据错误类型决定是否重试
    return error.message.includes('rate limit') ||
           error.message.includes('timeout') ||
           error.message.includes('network error');
  }

  calculateDelay(attempt) {
    // 指数退避策略
    return this.baseDelay * Math.pow(2, attempt);
  }
}

// 结果后处理器类
class ResultProcessor {
  static cleanText(text) {
    return text
      .replace(/\s+/g, ' ')           // 合并多个空格
      .replace(/^\s+|\s+$/g, '')      // 去除首尾空格
      .replace(/[\u200B-\u200D\uFEFF]/g, ''); // 去除零宽字符
  }

  static formatTranslation(text, sourceLang, targetLang) {
    return {
      original: text,
      translated: this.cleanText(text),
      sourceLang,
      targetLang,
      timestamp: Date.now()
    };
  }

  static formatExplanation(text) {
    return {
      original: text,
      explanation: this.cleanText(text),
      timestamp: Date.now()
    };
  }

  static formatLanguageDetection(text, language) {
    return {
      text,
      language: language.toLowerCase(),
      confidence: 1.0, // 可以添加置信度计算
      timestamp: Date.now()
    };
  }

  static formatDomainDetection(text, domain) {
    return {
      text,
      domain: this.cleanText(domain),
      timestamp: Date.now()
    };
  }
}

export { CacheManager, RateLimiter, RetryManager, ResultProcessor };