import { SiliconFlowService } from './siliconflowService';
import { ContextManager } from './contextManager';
import { AgentManager } from './agentManager';
import { ReasoningEngine } from './reasoningEngine';
import { 
  AIRequest, 
  AIResponse, 
  AgentType, 
  WorkflowStep,
  ContentGenerationRequest,
  StreamResponse 
} from '../types';
import { EventEmitter } from 'events';

export class AIIntegrationService extends EventEmitter {
  private siliconFlow: SiliconFlowService;
  private contextManager: ContextManager;
  private agentManager: AgentManager;
  private reasoningEngine: ReasoningEngine;
  private activeStreams: Map<string, any> = new Map();

  constructor(
    siliconFlowConfig: any,
    contextManager: ContextManager,
    agentManager: AgentManager,
    reasoningEngine: ReasoningEngine
  ) {
    super();
    
    this.siliconFlow = new SiliconFlowService(siliconFlowConfig);
    this.contextManager = contextManager;
    this.agentManager = agentManager;
    this.reasoningEngine = reasoningEngine;

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle SiliconFlow events
    this.siliconFlow.on('rateLimitExceeded', (data) => {
      this.emit('rateLimitExceeded', data);
    });

    this.siliconFlow.on('apiError', (error) => {
      this.emit('apiError', error);
    });

    // Handle reasoning engine events
    this.reasoningEngine.on('stepCompleted', (step) => {
      this.emit('workflowProgress', step);
    });

    this.reasoningEngine.on('workflowCompleted', (result) => {
      this.emit('workflowCompleted', result);
    });
  }

  /**
   * Process AI request with full MCP intelligence
   */
  async processRequest(request: AIRequest): Promise<AIResponse> {
    try {
      // Update context with new request
      await this.contextManager.updateContext(request.userId, {
        type: 'user_message',
        content: request.message,
        timestamp: new Date(),
        metadata: request.metadata
      });

      // Get current context for reasoning
      const context = await this.contextManager.getContext(request.userId);

      // Use reasoning engine to determine best approach
      const reasoning = await this.reasoningEngine.processRequest(request, context);

      // Execute the determined workflow
      const result = await this.executeWorkflow(reasoning.workflow, request, context);

      // Update context with response
      await this.contextManager.updateContext(request.userId, {
        type: 'assistant_response',
        content: result.content,
        timestamp: new Date(),
        metadata: {
          agent: reasoning.selectedAgent,
          cost: result.cost,
          workflow: reasoning.workflow.id
        }
      });

      return {
        content: result.content,
        agent: reasoning.selectedAgent,
        cost: result.cost,
        metadata: {
          reasoning: reasoning.explanation,
          workflow: reasoning.workflow.id,
          steps: reasoning.workflow.steps.length,
          context_used: context.messages.length
        },
        suggestions: await this.generateSuggestions(request, result)
      };

    } catch (error) {
      this.emit('processingError', { request, error });
      throw error;
    }
  }

  /**
   * Process streaming AI request
   */
  async *processStreamingRequest(request: AIRequest): AsyncGenerator<StreamResponse> {
    const streamId = `${request.userId}_${Date.now()}`;
    
    try {
      // Update context
      await this.contextManager.updateContext(request.userId, {
        type: 'user_message',
        content: request.message,
        timestamp: new Date(),
        metadata: request.metadata
      });

      const context = await this.contextManager.getContext(request.userId);
      const reasoning = await this.reasoningEngine.processRequest(request, context);

      // For streaming, we'll use the primary agent directly
      const agent = this.agentManager.getAgent(reasoning.selectedAgent);
      const prompt = await this.buildPrompt(request, context, agent);

      const stream = this.siliconFlow.generateText(prompt, {
        stream: true,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        temperature: agent.temperature
      }) as AsyncGenerator<StreamResponse>;

      this.activeStreams.set(streamId, stream);

      let fullContent = '';
      
      for await (const chunk of stream) {
        fullContent += chunk.content;
        
        yield {
          ...chunk,
          streamId,
          agent: reasoning.selectedAgent
        };

        if (chunk.finished) {
          // Update context with final response
          await this.contextManager.updateContext(request.userId, {
            type: 'assistant_response',
            content: fullContent,
            timestamp: new Date(),
            metadata: {
              agent: reasoning.selectedAgent,
              cost: chunk.cost,
              streamId
            }
          });

          this.activeStreams.delete(streamId);
        }
      }

    } catch (error) {
      this.activeStreams.delete(streamId);
      this.emit('streamingError', { request, error, streamId });
      throw error;
    }
  }

  /**
   * Execute a complete workflow
   */
  private async executeWorkflow(
    workflow: { id: string; steps: WorkflowStep[] },
    request: AIRequest,
    context: any
  ): Promise<{ content: string; cost: number; artifacts?: any[] }> {
    let totalCost = 0;
    let finalContent = '';
    const artifacts: any[] = [];

    for (const step of workflow.steps) {
      const agent = this.agentManager.getAgent(step.agent);
      
      switch (step.type) {
        case 'text_generation':
          const textResult = await this.generateText(step, request, context, agent);
          finalContent += textResult.content;
          totalCost += textResult.cost;
          break;

        case 'content_creation':
          const contentResult = await this.createContent(step, request, context);
          artifacts.push(contentResult);
          totalCost += contentResult.totalCost;
          break;

        case 'analysis':
          const analysisResult = await this.performAnalysis(step, request, context, agent);
          finalContent += analysisResult.content;
          totalCost += analysisResult.cost;
          break;

        case 'workflow_optimization':
          const optimizationResult = await this.optimizeWorkflow(step, request, context, agent);
          finalContent += optimizationResult.content;
          totalCost += optimizationResult.cost;
          break;
      }

      // Emit progress
      this.emit('workflowProgress', {
        workflowId: workflow.id,
        step: step.id,
        completed: true,
        cost: totalCost
      });
    }

    return {
      content: finalContent,
      cost: totalCost,
      artifacts: artifacts.length > 0 ? artifacts : undefined
    };
  }

  /**
   * Generate text using specific agent
   */
  private async generateText(
    step: WorkflowStep,
    request: AIRequest,
    context: any,
    agent: any
  ): Promise<{ content: string; cost: number }> {
    const prompt = await this.buildPrompt(request, context, agent, step.instructions);
    
    const result = await this.siliconFlow.generateText(prompt, {
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      temperature: agent.temperature,
      maxTokens: step.maxTokens || 4000
    }) as any;

    return {
      content: result.content,
      cost: result.cost
    };
  }

  /**
   * Create multimedia content
   */
  private async createContent(
    step: WorkflowStep,
    request: AIRequest,
    context: any
  ): Promise<any> {
    const contentRequest: ContentGenerationRequest = {
      prompt: request.message,
      includeImage: step.includeImage || false,
      includeVideo: step.includeVideo || false,
      includeAudio: step.includeAudio || false,
      imageStyle: step.imageStyle,
      videoDuration: step.videoDuration,
      voiceStyle: step.voiceStyle
    };

    return await this.siliconFlow.createCompleteContent(contentRequest);
  }

  /**
   * Perform data analysis
   */
  private async performAnalysis(
    step: WorkflowStep,
    request: AIRequest,
    context: any,
    agent: any
  ): Promise<{ content: string; cost: number }> {
    const analysisPrompt = `
Analyze the following request and context:

Request: ${request.message}
Context: ${JSON.stringify(context.summary)}
Analysis Type: ${step.analysisType || 'general'}

Provide detailed insights, patterns, and recommendations.
`;

    const result = await this.siliconFlow.generateText(analysisPrompt, {
      model: agent.model,
      systemPrompt: agent.systemPrompt + '\n\nYou are an expert data analyst.',
      temperature: 0.3 // Lower temperature for analysis
    }) as any;

    return {
      content: result.content,
      cost: result.cost
    };
  }

  /**
   * Optimize workflow
   */
  private async optimizeWorkflow(
    step: WorkflowStep,
    request: AIRequest,
    context: any,
    agent: any
  ): Promise<{ content: string; cost: number }> {
    const optimizationPrompt = `
Optimize the following workflow based on the request and context:

Request: ${request.message}
Current Context: ${JSON.stringify(context.summary)}
Optimization Goal: ${step.optimizationGoal || 'efficiency'}

Provide specific recommendations for improvement.
`;

    const result = await this.siliconFlow.generateText(optimizationPrompt, {
      model: agent.model,
      systemPrompt: agent.systemPrompt + '\n\nYou are an expert workflow optimizer.',
      temperature: 0.4
    }) as any;

    return {
      content: result.content,
      cost: result.cost
    };
  }

  /**
   * Build optimized prompt for AI generation
   */
  private async buildPrompt(
    request: AIRequest,
    context: any,
    agent: any,
    additionalInstructions?: string
  ): Promise<string> {
    const recentMessages = context.messages.slice(-5); // Last 5 messages for context
    const userPreferences = context.preferences || {};

    let prompt = `Context from recent conversation:\n`;
    
    recentMessages.forEach((msg: any, index: number) => {
      prompt += `${msg.type === 'user_message' ? 'User' : 'Assistant'}: ${msg.content}\n`;
    });

    prompt += `\nCurrent request: ${request.message}\n`;

    if (userPreferences.language) {
      prompt += `\nUser prefers responses in: ${userPreferences.language}\n`;
    }

    if (userPreferences.style) {
      prompt += `\nUser prefers communication style: ${userPreferences.style}\n`;
    }

    if (additionalInstructions) {
      prompt += `\nAdditional instructions: ${additionalInstructions}\n`;
    }

    prompt += `\nPlease provide a helpful, accurate, and contextually appropriate response.`;

    return prompt;
  }

  /**
   * Generate smart suggestions for next actions
   */
  private async generateSuggestions(
    request: AIRequest,
    result: any
  ): Promise<string[]> {
    const suggestionPrompt = `
Based on this conversation:
User: ${request.message}
Assistant: ${result.content}

Generate 3 helpful follow-up suggestions that the user might want to explore next.
Return only the suggestions, one per line.
`;

    try {
      const suggestions = await this.siliconFlow.generateText(suggestionPrompt, {
        model: 'doubao-1.5-pro-32k',
        temperature: 0.8,
        maxTokens: 200
      }) as any;

      return suggestions.content
        .split('\n')
        .filter((s: string) => s.trim().length > 0)
        .slice(0, 3);
    } catch (error) {
      return [
        'Ask a follow-up question',
        'Request more details',
        'Explore related topics'
      ];
    }
  }

  /**
   * Get AI service status and metrics
   */
  async getStatus(): Promise<{
    siliconflow: any;
    activeStreams: number;
    totalRequests: number;
    averageResponseTime: number;
    costToday: number;
  }> {
    const siliconflowStatus = await this.siliconFlow.healthCheck();
    
    return {
      siliconflow: siliconflowStatus,
      activeStreams: this.activeStreams.size,
      totalRequests: await this.contextManager.getTotalRequests(),
      averageResponseTime: await this.contextManager.getAverageResponseTime(),
      costToday: await this.contextManager.getCostToday()
    };
  }

  /**
   * Stop a streaming request
   */
  stopStream(streamId: string): boolean {
    if (this.activeStreams.has(streamId)) {
      this.activeStreams.delete(streamId);
      return true;
    }
    return false;
  }

  /**
   * Get available models and their capabilities
   */
  getAvailableModels() {
    return this.siliconFlow.getModelInfo();
  }

  /**
   * Update agent configuration
   */
  updateAgentConfig(agentType: AgentType, config: any): void {
    this.agentManager.updateAgent(agentType, config);
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(userId: string, timeframe: 'day' | 'week' | 'month' = 'day') {
    return await this.contextManager.getUsageAnalytics(userId, timeframe);
  }
}

