import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';
import { SiliconFlowConfig, ModelResponse, StreamResponse, ContentGenerationRequest } from '../types';

export class SiliconFlowService extends EventEmitter {
  private client: AxiosInstance;
  private config: SiliconFlowConfig;
  private rateLimiter: Map<string, number> = new Map();

  constructor(config: SiliconFlowConfig) {
    super();
    this.config = config;
    this.client = axios.create({
      baseURL: 'https://api.siliconflow.cn/v1',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Flowmatik/1.0'
      },
      timeout: 60000
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for rate limiting
    this.client.interceptors.request.use(async (config) => {
      await this.checkRateLimit();
      return config;
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        this.handleApiError(error);
        throw error;
      }
    );
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const lastRequest = this.rateLimiter.get('last_request') || 0;
    const minInterval = 100; // 100ms between requests

    if (now - lastRequest < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - (now - lastRequest)));
    }

    this.rateLimiter.set('last_request', Date.now());
  }

  private handleApiError(error: any): void {
    if (error.response?.status === 429) {
      this.emit('rateLimitExceeded', error.response.data);
    } else if (error.response?.status >= 500) {
      this.emit('serverError', error.response.data);
    } else {
      this.emit('apiError', error.response?.data || error.message);
    }
  }

  /**
   * Generate text using Doubao model with streaming support
   */
  async generateText(
    prompt: string,
    options: {
      model?: string;
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    } = {}
  ): Promise<ModelResponse | AsyncGenerator<StreamResponse>> {
    const {
      model = 'doubao-1.5-pro-32k',
      stream = false,
      temperature = 0.7,
      maxTokens = 4000,
      systemPrompt
    } = options;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream
    };

    if (stream) {
      return this.streamResponse(payload);
    } else {
      const response = await this.client.post('/chat/completions', payload);
      return this.formatResponse(response.data);
    }
  }

  /**
   * Generate image using FLUX model
   */
  async generateImage(
    prompt: string,
    options: {
      model?: string;
      size?: string;
      quality?: string;
      style?: string;
    } = {}
  ): Promise<{ url: string; cost: number }> {
    const {
      model = 'FLUX.1-schnell',
      size = '1024x1024',
      quality = 'standard',
      style = 'natural'
    } = options;

    const payload = {
      model,
      prompt,
      size,
      quality,
      style,
      n: 1
    };

    const response = await this.client.post('/images/generations', payload);
    
    return {
      url: response.data.data[0].url,
      cost: this.calculateImageCost(model)
    };
  }

  /**
   * Generate video using Wan2.1 model
   */
  async generateVideo(
    prompt: string,
    options: {
      model?: string;
      duration?: number;
      fps?: number;
      resolution?: string;
    } = {}
  ): Promise<{ url: string; cost: number }> {
    const {
      model = 'Wan2.1-T2V-14B-Turbo',
      duration = 5,
      fps = 24,
      resolution = '720p'
    } = options;

    const payload = {
      model,
      prompt,
      duration,
      fps,
      resolution
    };

    const response = await this.client.post('/videos/generations', payload);
    
    return {
      url: response.data.data[0].url,
      cost: this.calculateVideoCost(model, duration)
    };
  }

  /**
   * Generate audio using CosyVoice model
   */
  async generateAudio(
    text: string,
    options: {
      model?: string;
      voice?: string;
      speed?: number;
      format?: string;
    } = {}
  ): Promise<{ url: string; cost: number }> {
    const {
      model = 'CosyVoice2-0.5B',
      voice = 'female_calm',
      speed = 1.0,
      format = 'mp3'
    } = options;

    const payload = {
      model,
      input: text,
      voice,
      speed,
      response_format: format
    };

    const response = await this.client.post('/audio/speech', payload);
    
    return {
      url: response.data.url,
      cost: this.calculateAudioCost(text.length)
    };
  }

  /**
   * Create complete content package (text + image + video + audio)
   */
  async createCompleteContent(request: ContentGenerationRequest): Promise<{
    text: ModelResponse;
    image?: { url: string; cost: number };
    video?: { url: string; cost: number };
    audio?: { url: string; cost: number };
    totalCost: number;
  }> {
    const results: any = {};
    let totalCost = 0;

    // Generate text content
    const textResponse = await this.generateText(request.prompt, {
      systemPrompt: request.systemPrompt,
      temperature: request.temperature
    }) as ModelResponse;
    
    results.text = textResponse;
    totalCost += textResponse.cost;

    // Generate image if requested
    if (request.includeImage) {
      const imageResult = await this.generateImage(request.prompt, {
        style: request.imageStyle
      });
      results.image = imageResult;
      totalCost += imageResult.cost;
    }

    // Generate video if requested
    if (request.includeVideo) {
      const videoResult = await this.generateVideo(request.prompt, {
        duration: request.videoDuration
      });
      results.video = videoResult;
      totalCost += videoResult.cost;
    }

    // Generate audio if requested
    if (request.includeAudio && textResponse.content) {
      const audioResult = await this.generateAudio(textResponse.content, {
        voice: request.voiceStyle
      });
      results.audio = audioResult;
      totalCost += audioResult.cost;
    }

    results.totalCost = totalCost;
    return results;
  }

  /**
   * Stream response for real-time text generation
   */
  private async *streamResponse(payload: any): AsyncGenerator<StreamResponse> {
    const response = await this.client.post('/chat/completions', payload, {
      responseType: 'stream'
    });

    let buffer = '';
    
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta;
            
            if (delta?.content) {
              yield {
                content: delta.content,
                finished: false,
                cost: 0
              };
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    yield {
      content: '',
      finished: true,
      cost: this.calculateTextCost(payload.model, payload.messages)
    };
  }

  private formatResponse(data: any): ModelResponse {
    const choice = data.choices[0];
    const usage = data.usage;

    return {
      content: choice.message.content,
      model: data.model,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens
      },
      cost: this.calculateTextCost(data.model, usage.total_tokens),
      finishReason: choice.finish_reason
    };
  }

  private calculateTextCost(model: string, tokensOrMessages: number | any[]): number {
    const costs: Record<string, number> = {
      'doubao-1.5-pro-32k': 0.11, // per million tokens
      'doubao-1.5-pro-256k': 0.18
    };

    const costPerMillion = costs[model] || 0.11;
    const tokens = typeof tokensOrMessages === 'number' 
      ? tokensOrMessages 
      : this.estimateTokens(tokensOrMessages);

    return (tokens / 1000000) * costPerMillion;
  }

  private calculateImageCost(model: string): number {
    const costs: Record<string, number> = {
      'FLUX.1-schnell': 0.0014,
      'FLUX.1-dev': 0.0028
    };
    return costs[model] || 0.0014;
  }

  private calculateVideoCost(model: string, duration: number): number {
    const costs: Record<string, number> = {
      'Wan2.1-T2V-14B-Turbo': 0.21 // per video
    };
    return costs[model] || 0.21;
  }

  private calculateAudioCost(textLength: number): number {
    // CosyVoice2-0.5B: $7.15 per million bytes
    const estimatedBytes = textLength * 1000; // rough estimate
    return (estimatedBytes / 1000000) * 7.15;
  }

  private estimateTokens(messages: any[]): number {
    // Rough estimation: 1 token ≈ 0.75 words
    const text = messages.map(m => m.content).join(' ');
    return Math.ceil(text.split(' ').length / 0.75);
  }

  /**
   * Get model information and pricing
   */
  getModelInfo(): {
    text: Array<{ name: string; cost: string; context: string }>;
    image: Array<{ name: string; cost: string; quality: string }>;
    video: Array<{ name: string; cost: string; duration: string }>;
    audio: Array<{ name: string; cost: string; quality: string }>;
  } {
    return {
      text: [
        { name: 'doubao-1.5-pro-32k', cost: '$0.11/1M tokens', context: '32K tokens' },
        { name: 'doubao-1.5-pro-256k', cost: '$0.18/1M tokens', context: '256K tokens' }
      ],
      image: [
        { name: 'FLUX.1-schnell', cost: '$0.0014/image', quality: 'Fast, good quality' },
        { name: 'FLUX.1-dev', cost: '$0.0028/image', quality: 'Slower, best quality' }
      ],
      video: [
        { name: 'Wan2.1-T2V-14B-Turbo', cost: '$0.21/video', duration: 'Up to 10s' }
      ],
      audio: [
        { name: 'CosyVoice2-0.5B', cost: '$7.15/1M bytes', quality: 'Natural voice' }
      ]
    };
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{ status: string; latency: number; models: string[] }> {
    const start = Date.now();
    
    try {
      const response = await this.client.get('/models');
      const latency = Date.now() - start;
      
      return {
        status: 'healthy',
        latency,
        models: response.data.data.map((m: any) => m.id)
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - start,
        models: []
      };
    }
  }
}

