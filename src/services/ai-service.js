import OpenAI from 'openai';
import { CacheManager, RateLimiter, RetryManager, ResultProcessor } from '../utils/ai-utils';

// AI服务接口基类
class AIService {
  constructor(config) {
    this.config = config;
    this.cache = new CacheManager();
    this.rateLimiter = new RateLimiter(
      config.rateLimit?.maxRequests || 60,
      config.rateLimit?.timeWindow || 60000
    );
    this.retryManager = new RetryManager(
      config.retry?.maxRetries || 3,
      config.retry?.baseDelay || 1000
    );
  }

  async translate(text, targetLang) {
    throw new Error('Method not implemented');
  }

  async translateStream(text, targetLang, onChunk, onComplete) {
    try {
      throw new Error('Method not implemented');
    } catch (error) {
      console.error('TranslateStream方法未实现:', error);

      // 确保调用完成回调，以防止UI卡在加载状态
      if (onComplete) {
        try {
          onComplete({
            translated: text,
            explanation: "翻译服务错误: " + error.message,
            domain: "错误",
            sourceLang: 'auto',
            targetLang,
            timestamp: Date.now()
          });
        } catch (callbackError) {
          console.error('调用完成回调时出错:', callbackError);
        }
      }

      throw error;
    }
  }

  async explain(text) {
    throw new Error('Method not implemented');
  }

  async explainStream(text, onChunk, onComplete) {
    try {
      throw new Error('Method not implemented');
    } catch (error) {
      console.error('ExplainStream方法未实现:', error);

      // 确保调用完成回调
      if (onComplete) {
        try {
          onComplete({
            content: "解释服务错误: " + error.message,
            timestamp: Date.now()
          });
        } catch (callbackError) {
          console.error('调用完成回调时出错:', callbackError);
        }
      }

      throw error;
    }
  }

  async detectLanguage(text) {
    throw new Error('Method not implemented');
  }

  async detectDomain(text) {
    throw new Error('Method not implemented');
  }

  // 通用错误处理方法
  handleError(error) {
    console.error('AI Service Error:', error);
    throw new Error(`AI服务错误: ${error.message}`);
  }

  // 生成缓存键
  generateCacheKey(method, text, params = {}) {
    return `${method}:${text}:${JSON.stringify(params)}`;
  }

  // 通用API调用包装器
  async callWithRetry(operation) {
    return this.retryManager.execute(async () => {
      await this.rateLimiter.waitForSlot();
      return operation();
    });
  }

  // 通用缓存包装器
  async withCache(method, text, params, operation) {
    const cacheKey = this.generateCacheKey(method, text, params);
    const cachedResult = this.cache.get(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const result = await this.callWithRetry(operation);
    this.cache.set(cacheKey, result);
    return result;
  }
}

// OpenAI服务实现
class OpenAIService extends AIService {
  constructor(config) {
    super(config);
    if (!config.apiKeys?.openai) {
      throw new Error('OpenAI API密钥未配置');
    }
    const openaiConfig = {
      apiKey: config.apiKeys.openai,
      dangerouslyAllowBrowser: true
    };
    if (config.apiUrls?.openai) {
      openaiConfig.baseURL = config.apiUrls.openai;
    }
    this.client = new OpenAI(openaiConfig);
    this.model = config.openaiConfig?.model || "gpt-4o-mini";
  }

  // 识别常见OpenAI错误并给出更友好的错误信息
  handleOpenAIError(error) {
    // 网络相关错误
    if (error.code === 'ECONNABORTED') {
      throw new Error('网络连接超时，请检查网络设置');
    }
    if (error.message?.includes('Failed to fetch') || error.message?.includes('Network Error')) {
      throw new Error('网络连接失败，请检查网络设置');
    }

    // API密钥相关错误
    if (error.response?.status === 401) {
      throw new Error('OpenAI API密钥无效或已过期');
    }
    if (error.response?.status === 403) {
      throw new Error('没有权限访问OpenAI API，请检查账户状态');
    }

    // 限流和容量错误
    if (error.response?.status === 429) {
      const errorMessage = error.response?.data?.error?.message || '';
      if (errorMessage.includes('Rate limit')) {
        throw new Error('API调用频率超限，请稍后再试');
      }
      if (errorMessage.includes('capacity')) {
        throw new Error('OpenAI服务当前负载过高，请稍后再试');
      }
      throw new Error('API调用次数超限，请稍后再试或检查账户额度');
    }

    // 模型相关错误
    if (error.response?.status === 404) {
      throw new Error(`OpenAI模型"${this.model}"不存在或不可用，请在设置中选择其他模型`);
    }

    // 服务器错误
    if (error.response?.status >= 500) {
      throw new Error('OpenAI服务器错误，请稍后再试');
    }

    // 请求超时
    if (error.message?.includes('timeout')) {
      throw new Error('请求超时，OpenAI服务响应时间过长');
    }

    // 内容过滤
    if (error.message?.includes('content filter') || error.message?.includes('content_filter')) {
      throw new Error('您的请求触发了内容过滤器，请修改内容后重试');
    }

    // 默认错误
    console.error('OpenAI服务错误详情:', error);
    this.handleError(error);
  }

  async translate(text, targetLang) {
    return this.withCache('translate', text, { targetLang }, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: `你是一个专业的翻译和分析助手。请处理以下文本并返回三个信息：
1. 将文本翻译成${targetLang}
2. 提供一句话简短解释其含义（通俗易懂，让外行也能理解）
3. 确定文本所属的专业领域（如：计算机、医学、法律、经济等）

返回格式为JSON: {
  "translated": "翻译结果",
  "explanation": "一句话解释",
  "domain": "所属领域"
}`
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        let result;
        try {
          result = JSON.parse(response.choices[0].message.content);
        } catch (e) {
          // 如果解析失败，使用普通文本处理
          result = {
            translated: response.choices[0].message.content,
            explanation: "无法获取解释",
            domain: "未知"
          };
        }

        return {
          translated: result.translated || response.choices[0].message.content,
          explanation: result.explanation || "无法获取解释",
          domain: result.domain || "未知",
          sourceLang: 'auto',
          targetLang,
          timestamp: Date.now()
        };
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }

  async translateStream(text, targetLang, onChunk, onComplete) {
    try {
      let result = {
        translated: "",
        explanation: "...",
        domain: "...",
        sourceLang: 'auto',
        targetLang,
        timestamp: Date.now()
      };

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: `你是一个专业的翻译和分析助手。请处理以下文本并返回三个信息：
1. 将文本翻译成${targetLang}
2. 提供一句话简短解释其含义（通俗易懂，让外行也能理解）
3. 确定文本所属的专业领域（如：计算机、医学、法律、经济等）

每个部分使用特殊标记分开：
===翻译开始===
[翻译内容, 以${targetLang}语言输出]
===翻译结束===
===解释开始===
[解释内容, 以${targetLang}语言输出]
===解释结束===
===领域开始===
[领域内容, 以${targetLang}语言输出]
===领域结束===`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.3,
        stream: true
      });

      let fullText = "";
      let foundAnyMarkers = false;

      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (!content) continue;

        fullText += content;

        // 记录接收到的包含标记的块
        if (content.includes("===") && (content.includes("开始") || content.includes("结束"))) {
          console.log("OpenAI标记块:", content);
        }

        // 检查各个标记是否存在
        const hasTranslateMarker = fullText.includes("===翻译开始===");
        const hasExplainMarker = fullText.includes("===解释开始===");
        const hasDomainMarker = fullText.includes("===领域开始===");

        if (hasTranslateMarker || hasExplainMarker || hasDomainMarker) {
          foundAnyMarkers = true;
        }

        // 提取翻译内容
        if (hasTranslateMarker) {
          const extracted = extractContent(fullText, "===翻译开始===", "===翻译结束===");
          if (extracted && extracted.trim()) {
            result.translated = extracted.trim();
          }
        }

        // 提取领域内容
        if (hasDomainMarker) {
          const extracted = extractContent(fullText, "===领域开始===", "===领域结束===");
          if (extracted && extracted.trim()) {
            result.domain = extracted.trim();
          }
        }

        // 提取解释内容 - 只有当找到解释标记时才更新解释字段
        if (hasExplainMarker) {
          const extracted = extractContent(fullText, "===解释开始===", "===解释结束===");
          if (extracted && extracted.trim()) {
            result.explanation = extracted.trim();
          }
        }

        // 回调当前结果
        if (onChunk) {
          onChunk({...result});
        }
      }

      // 如果任何部分为空，填充默认值
      result.translated = result.translated.trim() || text;
      result.explanation = result.explanation.trim() || "无法获取解释";
      result.domain = result.domain.trim() || "未知";

      console.log('OpenAI完整响应结果:', {
        translated: result.translated,
        explanation: result.explanation,
        domain: result.domain
      });

      // 完成回调
      if (onComplete) {
        onComplete({...result});
      }

      // 同时缓存结果
      const cacheKey = this.generateCacheKey('translate', text, { targetLang });
      this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      this.handleOpenAIError(error);
    }
  }

  async explain(text) {
    return this.withCache('explain', text, {}, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "你是一个专业的解释助手。请对以下文本进行一句话简短解释，确保通俗易懂，让外行人士也能理解。禁止长篇大论，禁止分点分段，只能用一句话概括。返回格式为JSON: {\"explanation\": \"一句话解释\"}"
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        let result;
        try {
          result = JSON.parse(response.choices[0].message.content);
        } catch (e) {
          // 如果解析失败，使用普通文本处理
          result = {
            explanation: response.choices[0].message.content
          };
        }

        return {
          explanation: result.explanation || response.choices[0].message.content,
          timestamp: Date.now()
        };
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }

  async explainStream(text, onChunk, onComplete) {
    try {
      let result = {
        explanation: "",
        timestamp: Date.now()
      };

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "你是一个专业的解释助手。请对以下文本进行一句话简短解释，确保通俗易懂，让外行人士也能理解。禁止长篇大论，禁止分点分段，只能用一句话概括。"
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.3,
        stream: true
      });

      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (!content) continue;

        result.explanation += content;

        // 回调当前结果
        if (onChunk) {
          onChunk({...result});
        }
      }

      // 完成回调
      if (onComplete) {
        onComplete({...result});
      }

      // 同时缓存结果
      const cacheKey = this.generateCacheKey('explain', text, {});
      this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      this.handleOpenAIError(error);
    }
  }

  async detectLanguage(text) {
    return this.withCache('detectLanguage', text, {}, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "你是一个语言检测助手。请检测以下文本的语言，只返回ISO 639-1语言代码（如：zh、en、ja等）。"
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.1
        });
        return ResultProcessor.formatLanguageDetection(
          text,
          response.choices[0].message.content.trim().toLowerCase()
        );
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }

  async detectDomain(text) {
    return this.withCache('detectDomain', text, {}, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "你是一个领域检测助手。请检测以下文本属于哪个专业领域（如：计算机、医学、法律等），只返回领域名称。"
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.1
        });
        return ResultProcessor.formatDomainDetection(
          text,
          response.choices[0].message.content.trim()
        );
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }
}

// Ollama本地服务实现
class OllamaService extends AIService {
  constructor(config) {
    super(config);
    this.baseUrl = config.ollamaConfig.baseUrl || 'http://localhost:11434';
    this.model = config.ollamaConfig.model || 'qwen2.5:7b';
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 3;
    this.connectionTimeout = 5000;
  }

  // 识别Ollama特定错误并给出友好提示
  handleOllamaError(error) {
    const errorMsg = error.message || '';

    // 连接相关错误
    if (errorMsg.includes('AbortError') || errorMsg.includes('timeout')) {
      throw new Error('Ollama服务响应超时，请检查服务是否正常运行');
    }

    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('network error')) {
      throw new Error('无法连接到Ollama服务，请确保服务已启动并可以访问');
    }

    if (errorMsg.includes('无法连接到Ollama服务')) {
      throw new Error('无法连接到Ollama服务，请确保服务已启动且端口 11434 可访问');
    }

    // 模型相关错误
    if (errorMsg.includes('model') && errorMsg.includes('not found')) {
      throw new Error(`Ollama模型"${this.model}"未找到，请在Ollama中下载该模型`);
    }

    if (errorMsg.includes('模型 ') && errorMsg.includes(' 下载失败')) {
      throw new Error(`Ollama模型下载失败，请手动通过Ollama CLI下载"${this.model}"`);
    }

    // 权限错误
    if (errorMsg.includes('Permission denied') || errorMsg.includes('403')) {
      throw new Error('没有权限访问Ollama服务，请检查服务配置');
    }

    // API响应错误
    if (errorMsg.includes('Ollama API错误') || errorMsg.includes('Ollama返回数据格式错误')) {
      throw new Error('Ollama服务返回错误数据，可能是版本不兼容或配置问题');
    }

    // 默认错误处理
    console.error('Ollama服务错误详情:', error);
    throw new Error(`Ollama服务错误: ${errorMsg}`);
  }

  // 使用背景脚本的消息通信方式替代直接API调用
  async makeRequest(prompt) {
    if (!this.isConnected) {
      await this.checkConnection();
    }

    try {
      console.log('通过background.js发送请求到Ollama服务，模型:', this.model);

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "OLLAMA_API_REQUEST",
          action: "GENERATE",
          baseUrl: this.baseUrl,
          model: this.model,
          prompt: prompt
        }, response => {
          if (chrome.runtime.lastError) {
            this.isConnected = false;
            return reject(new Error('与背景脚本通信失败: ' + chrome.runtime.lastError.message));
          }

          if (!response || !response.success) {
            this.isConnected = false;
            return reject(new Error(response?.error || '请求失败，未收到有效响应'));
          }

          resolve(response.data);
        });
      });
    } catch (error) {
      this.isConnected = false;
      this.handleOllamaError(error);
    }
  }

  async checkConnection() {
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      this.isConnected = false;
      throw new Error(`无法连接到Ollama服务 (${this.baseUrl})。请确保：
1. Ollama 服务已启动
2. 浏览器扩展有权限访问本地服务
3. 端口 11434 未被占用`);
    }

    try {
      console.log(`通过background.js检查Ollama服务连接: ${this.baseUrl}`);

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "GET_CONFIG",
          action: "checkOllamaConnection",
          baseUrl: this.baseUrl
        }, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error('与背景脚本通信失败: ' + chrome.runtime.lastError.message));
          }

          if (!response || !response.success) {
            return reject(new Error(response?.error || '检查连接失败，未收到有效响应'));
          }

          resolve(response.data);
        });
      });

      if (!result.connected) {
        throw new Error(result.message);
      }

      // 如果有可用模型，更新模型列表
      if (result.models && result.models.length > 0) {
        console.log('发现可用Ollama模型:', result.models);
        // 优先使用第一个可用模型作为默认模型
        if (this.model === 'qwen2.5:7b' && result.models.length > 0) {
          this.model = result.models[0].name || result.models[0];
          console.log('自动设置默认模型为:', this.model);
        }
      }

      console.log('Ollama服务连接状态:', result.message);
      this.isConnected = true;
      this.connectionAttempts = 0;
      return true;
    } catch (error) {
      this.isConnected = false;
      this.connectionAttempts++;

      let errorMessage = error.message;
      console.warn(`Ollama服务连接失败 (${this.connectionAttempts}/${this.maxConnectionAttempts}): ${errorMessage}`);

      if (this.connectionAttempts < this.maxConnectionAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.checkConnection();
      }

      throw new Error(errorMessage);
    }
  }

  async getAvailableModels() {
    try {
      console.log(`通过background.js获取Ollama可用模型列表: ${this.baseUrl}`);

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "OLLAMA_API_REQUEST",
          action: "LIST_MODELS",
          baseUrl: this.baseUrl
        }, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error('与背景脚本通信失败: ' + chrome.runtime.lastError.message));
          }

          if (!response || !response.success) {
            return reject(new Error(response?.error || '获取模型列表失败，未收到有效响应'));
          }

          resolve(response.data);
        });
      });
    } catch (error) {
      console.error('获取Ollama模型列表失败:', error);
      throw error;
    }
  }

  async translate(text, targetLang) {
    return this.withCache('translate', text, { targetLang }, async () => {
      try {
        const prompt = `你是一个专业的翻译和分析助手。请处理以下文本并返回三个信息：
1. 将文本翻译成${targetLang}
2. 提供一句话简短解释其含义（通俗易懂，让外行也能理解）
3. 确定文本所属的专业领域（如：计算机、医学、法律、经济等）

返回格式为JSON: {
  "translated": "翻译结果",
  "explanation": "一句话解释",
  "domain": "所属领域"
}

以下为需要处理的文本：
${text}`;

        const result = await this.makeRequest(prompt);

        // 尝试解析JSON结果
        try {
          // 清理可能的Markdown代码块标记
          const cleanResult = result.replace(/```json\s*|\s*```/g, '').trim();
          const parsedResult = JSON.parse(cleanResult);
          return {
            translated: parsedResult.translated || result,
            explanation: parsedResult.explanation || "无法获取解释",
            domain: parsedResult.domain || "未知",
            sourceLang: 'auto',
            targetLang,
            timestamp: Date.now()
          };
        } catch (e) {
          console.error('解析Ollama响应失败:', e);
          // 解析失败时返回原始文本作为翻译结果
          return {
            translated: result,
            explanation: "无法获取解释",
            domain: "未知",
            sourceLang: 'auto',
            targetLang,
            timestamp: Date.now()
          };
        }
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  async translateStream(text, targetLang, onChunk, onComplete) {
    return this.withCache('translate', text, { targetLang }, async () => {
      try {
        // 使用英文标签和特殊格式来确保不会被翻译
        const prompt = `你是一个专业的翻译和分析助手, 请处理以下文本并返回三个信息:
1. 将文本翻译成${targetLang}
2. 提供一句话简短解释其含义(通俗易懂, 让外行也能理解), 以${targetLang}语言输出
3. 确定文本所属的专业领域(如: 计算机, 医学, 法律, 经济等), 以${targetLang}语言输出

保持以下标记完全不变, 并严格按照以下格式回复:

<TRANSLATION>

<DOMAIN>

<EXPLANATION>

以下为需要处理的文本:
${text}
`;

        console.log('Ollama请求翻译:', text, '目标语言:', targetLang);

        let fullText = "";
        let resultObj = {
          translated: "",
          explanation: "...",
          domain: "...",
          sourceLang: 'auto',
          targetLang,
          timestamp: Date.now()
        };

        await this.makeStreamRequest(prompt, (chunk, currentText) => {
          fullText = currentText;

          try {
            // 提取翻译、解释和领域内容
            resultObj = this.parseTranslationResponse(currentText, resultObj);

            // 分发更新
            if (onChunk) {
              onChunk({...resultObj});
            }
          } catch (e) {
            console.error('Ollama解析响应出错:', e);
          }
        }, (finalText) => {
          console.log('Ollama完整响应:', finalText);

          // 最终解析
          resultObj = this.parseTranslationResponse(finalText, resultObj);

          // 确保所有字段都有值
          if (!resultObj.translated) resultObj.translated = text;
          if (!resultObj.explanation) resultObj.explanation = "无法获取解释";
          if (!resultObj.domain) resultObj.domain = "未知";

          if (onComplete) {
            onComplete({...resultObj});
          }
        });

        return resultObj;
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  parseTranslationResponse(text, currentResult = {}) {
    const result = { ...currentResult };

    // 创建一个提取标签内容的函数
    const extractTagContent = (text, startTag, endTag) => {
      const startIndex = text.indexOf(startTag);
      if (startIndex === -1) return null;

      const contentStartIndex = startIndex + startTag.length;
      let endIndex;

      if (endTag) {
        endIndex = text.indexOf(endTag, contentStartIndex);
        if (endIndex === -1) endIndex = text.length;
      } else {
        endIndex = text.length;
      }

      return text.substring(contentStartIndex, endIndex).trim();
    };

    try {
      // 使用英文标签的正则表达式提取内容
      const translateRegex = /<TRANSLATION>([\s\S]*?)(?=<DOMAIN>|<EXPLANATION>|$)/i;
      const domainRegex = /<DOMAIN>([\s\S]*?)(?=<TRANSLATION>|<EXPLANATION>|$)/i;
      const explainRegex = /<EXPLANATION>([\s\S]*?)(?=<TRANSLATION>|<DOMAIN>|$)/i;

      // 提取翻译内容
      const translateMatch = text.match(translateRegex);
      if (translateMatch && translateMatch[1].trim()) {
        result.translated = translateMatch[1].trim();
      }

      // 提取领域内容 - 只有真正找到领域标记和内容时才更新
      const domainMatch = text.match(domainRegex);
      if (domainMatch && domainMatch[1].trim()) {
        result.domain = domainMatch[1].trim();
      }

      // 提取解释内容 - 只有真正找到解释标记和内容时才更新
      const explainMatch = text.match(explainRegex);
      if (explainMatch && explainMatch[1].trim()) {
        result.explanation = explainMatch[1].trim();
      }

      // 如果正则表达式方法失败，尝试备用提取方法
      if (!result.translated) {
        // 备用方法：通过标签定位然后提取至下一个标签
        const translatedContent = extractTagContent(text, '<TRANSLATION>', '<DOMAIN>');
        if (translatedContent) result.translated = translatedContent;
      }

      // 只有当尚未提取到领域内容时，才尝试备用方法提取
      if (result.domain === "...") {
        const domainContent = extractTagContent(text, '<DOMAIN>', '<EXPLANATION>');
        if (domainContent && domainContent.trim()) result.domain = domainContent;
      }

      // 只有当尚未提取到解释内容时，才尝试备用方法提取
      if (result.explanation === "...") {
        const explanationContent = extractTagContent(text, '<EXPLANATION>', null);
        if (explanationContent && explanationContent.trim()) result.explanation = explanationContent;
      }

      // 如果仍然无法提取，尝试启发式方法
      if (!result.translated && !text.includes('<TRANSLATION>')) {
        const lines = text.split('\n').filter(line => line.trim());
        const nonEmptyLines = lines.filter(line =>
          line.trim() &&
          !line.includes('请') &&
          !line.includes('文本：') &&
          !line.includes('处理') &&
          !line.includes('<')
        );

        if (nonEmptyLines.length >= 1) {
          result.translated = nonEmptyLines[0];
        }

        // 只有当解释仍为"未知"且内容中包含符合解释特征的行时才更新解释
        if (result.explanation === "..." && nonEmptyLines.length >= 2 && !text.includes('<EXPLANATION>')) {
          for (let i = 1; i < nonEmptyLines.length; i++) {
            const line = nonEmptyLines[i];
            if (line.includes('是') || line.includes('指') || line.includes('表示')) {
              result.explanation = line;
              break;
            }
          }
        }

        // 只有当领域仍为"未知"且有合适的行时才更新领域
        if (result.domain === "..." && nonEmptyLines.length >= 3 && !text.includes('<DOMAIN>')) {
          const lastLine = nonEmptyLines[nonEmptyLines.length - 1];
          if (lastLine.length < 20) {
            result.domain = lastLine;
          }
        }
      }
    } catch (e) {
      console.error('解析翻译响应时出错:', e);
    }

    return result;
  }

  async explain(text) {
    return this.withCache('explain', text, {}, async () => {
      try {
        const prompt = `请对以下文本进行一句话简短解释，确保通俗易懂，让外行人士也能理解。禁止长篇大论，禁止分点分段，只能用一句话概括：\n${text}`;
        const result = await this.makeRequest(prompt);
        return ResultProcessor.formatExplanation(result);
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  async explainStream(text, onChunk, onComplete) {
    return this.withCache('explain', text, {}, async () => {
      try {
        const prompt = `请对以下文本进行一句话简短解释，确保通俗易懂，让外行人士也能理解。禁止长篇大论，禁止分点分段，只能用一句话概括：\n${text}`;

        let resultObj = {
          explanation: "",
          timestamp: Date.now()
        };

        await this.makeStreamRequest(prompt, (chunk) => {
          resultObj.explanation += chunk;
          if (onChunk) {
            onChunk({...resultObj});
          }
        }, (finalText) => {
          resultObj.explanation = finalText.trim();
          if (onComplete) {
            onComplete({...resultObj});
          }
        });

        return resultObj;
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  async detectDomain(text) {
    return this.withCache('detectDomain', text, {}, async () => {
      try {
        const prompt = `请检测以下文本属于哪个专业领域（如：计算机、医学、法律等），只返回领域名称：\n${text}`;
        const result = await this.makeRequest(prompt);
        return ResultProcessor.formatDomainDetection(text, result.trim());
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  // 流式请求
  async makeStreamRequest(prompt, onChunk, onComplete) {
    if (!this.isConnected) {
      await this.checkConnection();
    }

    try {
      console.log('通过background.js发送流式请求到Ollama服务，模型:', this.model);

      return new Promise((resolve, reject) => {
        let finalResult = "";
        let messageListener;
        let timeoutId;

        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          if (messageListener) {
            try {
              chrome.runtime.onMessage.removeListener(messageListener);
            } catch (e) {
              console.warn('移除消息监听器失败:', e);
            }
          }
        };

        // 创建消息监听器
        messageListener = (message, sender, sendResponse) => {
          try {
            // 调试日志
            console.log('收到消息:', message);

            // 检查消息类型
            if (!message || typeof message !== 'object' || message.type !== "OLLAMA_STREAM_RESPONSE") {
              return false; // 不是我们要处理的消息
            }

            // 处理错误
            if (message.error) {
              console.error('Ollama流响应错误:', message.error);
              cleanup();
              this.isConnected = false;
              reject(new Error(message.error));
              return false;
            }

            // 处理数据块
            if (message.chunk) {
              finalResult += message.chunk;
              if (onChunk) {
                onChunk(message.chunk, finalResult);
              }
            }

            // 处理完成信号
            if (message.done) {
              console.log('Ollama流响应完成');
              cleanup();
              if (onComplete) {
                onComplete(finalResult);
              }
              resolve(finalResult);
              return false;
            }

            return false; // 不需要异步响应
          } catch (e) {
            console.error('处理Ollama流响应出错:', e);
            cleanup();
            reject(e);
            return false;
          }
        };

        // 先注册监听器
        chrome.runtime.onMessage.addListener(messageListener);

        // 发送初始请求
        console.log('发送Ollama流式请求:', {
          type: "OLLAMA_API_REQUEST",
          action: "GENERATE_STREAM",
          model: this.model
        });

        chrome.runtime.sendMessage({
          type: "OLLAMA_API_REQUEST",
          action: "GENERATE_STREAM",
          baseUrl: this.baseUrl,
          model: this.model,
          prompt: prompt
        }, (initResponse) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error('发送请求错误:', error);
            cleanup();
            this.isConnected = false;
            reject(new Error('与背景脚本通信失败: ' + error.message));
            return;
          }

          console.log('收到初始响应:', initResponse);

          if (!initResponse) {
            console.warn('初始响应为空，可能背景脚本未返回数据');
            // 不立即拒绝，等待监听器接收完成消息或超时
            return;
          }

          if (initResponse.error) {
            console.error('初始响应错误:', initResponse.error);
            cleanup();
            this.isConnected = false;
            reject(new Error(initResponse.error));
            return;
          }

          // 初始响应成功，等待流式数据
          console.log('Ollama流式请求已启动，等待数据流...');
        });

        // 设置超时处理
        timeoutId = setTimeout(() => {
          console.error('Ollama请求超时');
          cleanup();
          reject(new Error('请求超时，未收到任何响应'));
        }, 30000); // 30秒超时
      });
    } catch (error) {
      console.error('makeStreamRequest错误:', error);
      this.isConnected = false;
      this.handleOllamaError(error);
    }
  }
}

// 辅助函数：从文本中提取标记之间的内容
function extractContent(text, startMarker, endMarker) {
  try {
    // 处理可能的变体形式 (如===翻译 开始===)
    const startVariations = [
      startMarker,
      startMarker.replace("开始", " 开始"),
      startMarker.replace("===", ""),
      startMarker.replace("===", "").replace("开始", ""),
      startMarker.replace("开始", ":")
    ];

    const endVariations = [
      endMarker,
      endMarker.replace("结束", " 结束"),
      endMarker.replace("===", ""),
      endMarker.replace("===", "").replace("结束", "")
    ];

    // 尝试所有可能的变体组合
    for (const start of startVariations) {
      if (!text.includes(start)) continue;

      const contentStart = text.indexOf(start) + start.length;

      for (const end of endVariations) {
        if (!text.includes(end)) continue;

        const endIndex = text.indexOf(end, contentStart);
        if (endIndex !== -1) {
          return text.substring(contentStart, endIndex).trim();
        }
      }

      // 如果找到起始标记但没有找到结束标记
      // 返回从起始标记到下一个标记或文本结尾的内容
      const nextMarkerIndex = text.indexOf("===", contentStart);
      if (nextMarkerIndex !== -1) {
        return text.substring(contentStart, nextMarkerIndex).trim();
      } else {
        // 没有找到下一个标记，返回所有剩余内容
        return text.substring(contentStart).trim();
      }
    }

    return "";
  } catch (e) {
    console.error('提取内容异常:', e);
    return "";
  }
}

// AI服务工厂
class AIServiceFactory {
  static createService(type, config) {
    console.log(`AIServiceFactory: 创建 ${type} 服务，配置:`, config);

    try {
      switch(type) {
        case 'openai':
          // 确保配置满足要求
          if (!config.apiKeys || !config.apiKeys.openai) {
            console.warn('AIServiceFactory: OpenAI API密钥未配置');
            return new DummyService({
              errorMessage: 'OpenAI API密钥未配置，请在扩展设置中添加API密钥'
            });
          }

          // 确保OpenAI配置存在
          config.openaiConfig = config.openaiConfig || {};
          config.openaiConfig.model = config.openaiConfig.model || 'gpt-4o-mini';

          // 确保API URL存在
          config.apiUrls = config.apiUrls || {};
          config.apiUrls.openai = config.apiUrls.openai || 'https://api.openai.com/v1';

          console.log('AIServiceFactory: 创建OpenAI服务，使用模型:', config.openaiConfig.model);
          return new OpenAIService(config);

        case 'ollama':
          // 确保配置满足要求
          if (!config.ollamaConfig || !config.ollamaConfig.baseUrl) {
            console.warn('AIServiceFactory: Ollama 服务器地址未配置');
            return new DummyService({
              errorMessage: 'Ollama 服务器地址未配置，请在扩展设置中完成配置'
            });
          }

          console.log('AIServiceFactory: 创建Ollama服务，使用模型:', config.ollamaConfig.model);
          return new OllamaService(config);

        default:
          console.warn('AIServiceFactory: 未知服务类型:', type);
          return new DummyService({
            errorMessage: `未知服务类型: ${type}`
          });
      }
    } catch (error) {
      console.error('AIServiceFactory: 创建服务时出错:', error);
      return new DummyService({
        errorMessage: `创建服务时出错: ${error.message}`
      });
    }
  }
}

// 用于处理配置错误情况的虚拟服务
class DummyService extends AIService {
  constructor(config) {
    super(config);
    this.errorMessage = config.errorMessage || '服务未正确配置';
  }

  async translate() { throw new Error(this.errorMessage); }
  async translateStream() { throw new Error(this.errorMessage); }
  async explain() { throw new Error(this.errorMessage); }
  async explainStream() { throw new Error(this.errorMessage); }
  async detectLanguage() { return 'unknown'; }
  async detectDomain() { return 'unknown'; }
}

export { AIService, AIServiceFactory, OpenAIService, OllamaService, DummyService };