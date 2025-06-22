// 🧠 FLOWMATIK MCP - REASONING ENGINE
// Motor de razonamiento inteligente para decisiones complejas

import { EventEmitter } from 'events';
import { 
  MCPSession, 
  Message, 
  Intent, 
  Entity, 
  Agent,
  WorkflowStep,
  StepType,
  Knowledge,
  Pattern,
  Preference
} from '@/types';
import { logger } from '@/utils/logger';
import { SiliconFlowService } from '@/services/siliconflow';
import { ContextManager } from '@/services/contextManager';
import { AgentManager } from '@/services/agentManager';

/**
 * 🎯 Reasoning Engine - Motor de razonamiento avanzado
 * Implementa capacidades de razonamiento multi-step y toma de decisiones
 */
export class ReasoningEngine extends EventEmitter {
  private siliconflow: SiliconFlowService;
  private contextManager: ContextManager;
  private agentManager: AgentManager;
  private reasoningCache: Map<string, ReasoningResult> = new Map();

  constructor(contextManager: ContextManager, agentManager: AgentManager) {
    super();
    this.contextManager = contextManager;
    this.agentManager = agentManager;
    this.siliconflow = new SiliconFlowService();
    
    this.setupEventListeners();
    logger.info('🧠 ReasoningEngine initialized');
  }

  /**
   * 🎯 Procesar solicitud con razonamiento avanzado
   */
  async processRequest(
    sessionId: string, 
    message: Message, 
    requiresReasoning: boolean = true
  ): Promise<ReasoningResult> {
    const startTime = Date.now();
    
    try {
      // Obtener sesión y contexto
      const session = await this.contextManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // Analizar la solicitud
      const analysis = await this.analyzeRequest(message, session);
      
      // Determinar si requiere razonamiento complejo
      const needsComplexReasoning = requiresReasoning || this.requiresComplexReasoning(analysis);

      let result: ReasoningResult;

      if (needsComplexReasoning) {
        // Razonamiento multi-step
        result = await this.performComplexReasoning(message, session, analysis);
      } else {
        // Razonamiento simple
        result = await this.performSimpleReasoning(message, session, analysis);
      }

      // Actualizar métricas
      result.processingTime = Date.now() - startTime;
      
      // Cache del resultado
      this.cacheResult(sessionId, message.id, result);

      this.emit('reasoningCompleted', { sessionId, result });
      
      return result;

    } catch (error) {
      logger.error('Error in reasoning process:', error);
      
      return {
        success: false,
        confidence: 0,
        reasoning: 'Error en el proceso de razonamiento',
        steps: [],
        recommendations: [],
        processingTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 🔍 Analizar solicitud inicial
   */
  private async analyzeRequest(message: Message, session: MCPSession): Promise<RequestAnalysis> {
    const content = message.content;
    
    // Extraer intenciones
    const intents = await this.extractIntents(content);
    
    // Extraer entidades
    const entities = await this.extractEntities(content);
    
    // Analizar complejidad
    const complexity = this.analyzeComplexity(content, intents, entities);
    
    // Determinar dominio
    const domain = this.determineDomain(content, intents);
    
    // Analizar contexto histórico
    const contextualFactors = await this.analyzeContextualFactors(session, content);

    return {
      intents,
      entities,
      complexity,
      domain,
      contextualFactors,
      requiresMultiStep: complexity > 0.7,
      requiresExternalData: this.requiresExternalData(content),
      requiresUserInput: this.requiresUserInput(content),
    };
  }

  /**
   * 🧠 Razonamiento complejo multi-step
   */
  private async performComplexReasoning(
    message: Message, 
    session: MCPSession, 
    analysis: RequestAnalysis
  ): Promise<ReasoningResult> {
    const steps: ReasoningStep[] = [];
    let currentConfidence = 1.0;

    // Paso 1: Descomposición del problema
    const decomposition = await this.decomposeRequest(message, analysis);
    steps.push({
      type: 'decomposition',
      description: 'Descomposición del problema en sub-tareas',
      input: message.content,
      output: decomposition.subtasks.join(', '),
      confidence: decomposition.confidence,
      reasoning: decomposition.reasoning,
    });
    currentConfidence *= decomposition.confidence;

    // Paso 2: Análisis de dependencias
    const dependencies = await this.analyzeDependencies(decomposition.subtasks, session);
    steps.push({
      type: 'dependency_analysis',
      description: 'Análisis de dependencias entre sub-tareas',
      input: decomposition.subtasks.join(', '),
      output: dependencies.map(d => d.description).join(', '),
      confidence: 0.9,
      reasoning: 'Identificación de orden de ejecución y dependencias',
    });

    // Paso 3: Planificación de ejecución
    const executionPlan = await this.createExecutionPlan(decomposition.subtasks, dependencies);
    steps.push({
      type: 'planning',
      description: 'Creación del plan de ejecución',
      input: 'Sub-tareas y dependencias',
      output: executionPlan.description,
      confidence: executionPlan.confidence,
      reasoning: executionPlan.reasoning,
    });
    currentConfidence *= executionPlan.confidence;

    // Paso 4: Ejecución de sub-tareas
    const executionResults = await this.executeSubtasks(executionPlan.steps, session);
    steps.push(...executionResults.steps);
    currentConfidence *= executionResults.overallConfidence;

    // Paso 5: Síntesis de resultados
    const synthesis = await this.synthesizeResults(executionResults.results, message);
    steps.push({
      type: 'synthesis',
      description: 'Síntesis de resultados parciales',
      input: 'Resultados de sub-tareas',
      output: synthesis.summary,
      confidence: synthesis.confidence,
      reasoning: synthesis.reasoning,
    });

    // Generar recomendaciones
    const recommendations = await this.generateRecommendations(steps, analysis, session);

    return {
      success: true,
      confidence: currentConfidence,
      reasoning: synthesis.summary,
      steps,
      recommendations,
      processingTime: 0, // Se actualizará en el método principal
      metadata: {
        complexity: analysis.complexity,
        domain: analysis.domain,
        stepCount: steps.length,
      },
    };
  }

  /**
   * 🚀 Razonamiento simple
   */
  private async performSimpleReasoning(
    message: Message, 
    session: MCPSession, 
    analysis: RequestAnalysis
  ): Promise<ReasoningResult> {
    // Seleccionar agente apropiado
    const agent = await this.agentManager.selectBestAgent(session.id, message, analysis.intents[0]);
    
    // Generar respuesta directa
    const response = await this.agentManager.processWithAgent(agent, session.id, message);
    
    const step: ReasoningStep = {
      type: 'direct_response',
      description: `Respuesta directa usando agente ${agent.name}`,
      input: message.content,
      output: response.content,
      confidence: response.metadata?.confidence || 0.8,
      reasoning: `Procesado por ${agent.name} especializado en ${agent.role}`,
    };

    const recommendations = await this.generateSimpleRecommendations(response, agent);

    return {
      success: true,
      confidence: step.confidence,
      reasoning: response.content,
      steps: [step],
      recommendations,
      processingTime: 0,
      metadata: {
        agentUsed: agent.name,
        agentRole: agent.role,
        complexity: analysis.complexity,
      },
    };
  }

  /**
   * 🔍 Extraer intenciones del mensaje
   */
  private async extractIntents(content: string): Promise<Intent[]> {
    // Análisis básico de intenciones usando patrones
    const intents: Intent[] = [];
    
    const intentPatterns = {
      create_content: /crear|generar|escribir|diseñar/i,
      analyze_data: /analizar|datos|estadísticas|métricas/i,
      get_help: /ayuda|problema|error|soporte/i,
      optimize: /optimizar|mejorar|eficiencia/i,
      automate: /automatizar|workflow|proceso/i,
      learn: /aprender|enseñar|explicar|tutorial/i,
      search: /buscar|encontrar|localizar/i,
      compare: /comparar|diferencia|versus/i,
    };

    for (const [intentName, pattern] of Object.entries(intentPatterns)) {
      if (pattern.test(content)) {
        intents.push({
          name: intentName,
          confidence: 0.8,
          parameters: {},
          context: [content.substring(0, 100)],
        });
      }
    }

    // Si no se encuentra ninguna intención específica, usar general
    if (intents.length === 0) {
      intents.push({
        name: 'general',
        confidence: 0.6,
        parameters: {},
        context: [],
      });
    }

    return intents;
  }

  /**
   * 🏷️ Extraer entidades del mensaje
   */
  private async extractEntities(content: string): Promise<Entity[]> {
    const entities: Entity[] = [];
    
    // Patrones básicos de entidades
    const entityPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      url: /https?:\/\/[^\s]+/g,
      number: /\b\d+(?:\.\d+)?\b/g,
      date: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
      time: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
    };

    for (const [type, pattern] of Object.entries(entityPatterns)) {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const start = content.indexOf(match);
          entities.push({
            type,
            value: match,
            confidence: 0.9,
            start,
            end: start + match.length,
          });
        });
      }
    }

    return entities;
  }

  /**
   * 📊 Analizar complejidad de la solicitud
   */
  private analyzeComplexity(content: string, intents: Intent[], entities: Entity[]): number {
    let complexity = 0;

    // Factores de complejidad
    complexity += Math.min(content.length / 1000, 0.3); // Longitud del texto
    complexity += Math.min(intents.length * 0.2, 0.4); // Múltiples intenciones
    complexity += Math.min(entities.length * 0.1, 0.3); // Múltiples entidades

    // Palabras clave que indican complejidad
    const complexKeywords = [
      'comparar', 'analizar', 'optimizar', 'integrar', 'automatizar',
      'workflow', 'proceso', 'múltiple', 'varios', 'complejo'
    ];
    
    const complexMatches = complexKeywords.filter(keyword => 
      content.toLowerCase().includes(keyword)
    ).length;
    
    complexity += Math.min(complexMatches * 0.15, 0.3);

    return Math.min(complexity, 1.0);
  }

  /**
   * 🎯 Determinar dominio de la solicitud
   */
  private determineDomain(content: string, intents: Intent[]): string {
    const domainKeywords = {
      content: ['contenido', 'texto', 'imagen', 'video', 'crear', 'generar'],
      data: ['datos', 'análisis', 'estadísticas', 'métricas', 'reporte'],
      support: ['ayuda', 'problema', 'error', 'soporte', 'asistencia'],
      automation: ['automatizar', 'workflow', 'proceso', 'integrar'],
      business: ['negocio', 'empresa', 'estrategia', 'marketing'],
      technical: ['código', 'programar', 'sistema', 'servidor', 'api'],
    };

    let maxScore = 0;
    let domain = 'general';

    for (const [domainName, keywords] of Object.entries(domainKeywords)) {
      const score = keywords.filter(keyword => 
        content.toLowerCase().includes(keyword)
      ).length;
      
      if (score > maxScore) {
        maxScore = score;
        domain = domainName;
      }
    }

    return domain;
  }

  /**
   * 🔍 Analizar factores contextuales
   */
  private async analyzeContextualFactors(
    session: MCPSession, 
    content: string
  ): Promise<ContextualFactor[]> {
    const factors: ContextualFactor[] = [];

    // Factor de historial de conversación
    const historyLength = session.context.conversationHistory.length;
    if (historyLength > 0) {
      factors.push({
        type: 'conversation_history',
        value: historyLength,
        impact: Math.min(historyLength / 20, 1.0),
        description: `Conversación con ${historyLength} mensajes previos`,
      });
    }

    // Factor de preferencias del usuario
    const userPrefs = session.context.userPreferences;
    factors.push({
      type: 'user_preferences',
      value: userPrefs.ai.responseStyle,
      impact: 0.5,
      description: `Preferencia de estilo: ${userPrefs.ai.responseStyle}`,
    });

    // Factor de patrones aprendidos
    const patterns = session.memory.longTerm.userPatterns;
    if (patterns.length > 0) {
      factors.push({
        type: 'learned_patterns',
        value: patterns.length,
        impact: Math.min(patterns.length / 10, 0.8),
        description: `${patterns.length} patrones de comportamiento identificados`,
      });
    }

    return factors;
  }

  /**
   * 🧩 Descomponer solicitud en sub-tareas
   */
  private async decomposeRequest(
    message: Message, 
    analysis: RequestAnalysis
  ): Promise<DecompositionResult> {
    const content = message.content;
    const subtasks: string[] = [];
    
    // Lógica de descomposición basada en intenciones
    for (const intent of analysis.intents) {
      switch (intent.name) {
        case 'create_content':
          subtasks.push('Planificar estructura del contenido');
          subtasks.push('Generar contenido principal');
          subtasks.push('Revisar y optimizar contenido');
          break;
          
        case 'analyze_data':
          subtasks.push('Recopilar datos relevantes');
          subtasks.push('Procesar y limpiar datos');
          subtasks.push('Realizar análisis estadístico');
          subtasks.push('Generar insights y conclusiones');
          break;
          
        case 'automate':
          subtasks.push('Identificar proceso a automatizar');
          subtasks.push('Diseñar workflow automatizado');
          subtasks.push('Implementar automatización');
          subtasks.push('Probar y validar workflow');
          break;
          
        default:
          subtasks.push('Analizar solicitud específica');
          subtasks.push('Generar respuesta apropiada');
      }
    }

    // Si no hay sub-tareas específicas, crear genéricas
    if (subtasks.length === 0) {
      subtasks.push('Comprender la solicitud');
      subtasks.push('Buscar información relevante');
      subtasks.push('Formular respuesta');
    }

    return {
      subtasks,
      confidence: 0.8,
      reasoning: `Descompuesta en ${subtasks.length} sub-tareas basadas en las intenciones identificadas`,
    };
  }

  /**
   * 🔗 Analizar dependencias entre sub-tareas
   */
  private async analyzeDependencies(
    subtasks: string[], 
    session: MCPSession
  ): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    // Crear dependencias secuenciales básicas
    for (let i = 1; i < subtasks.length; i++) {
      dependencies.push({
        from: subtasks[i - 1],
        to: subtasks[i],
        type: 'sequential',
        description: `${subtasks[i]} depende de ${subtasks[i - 1]}`,
        strength: 0.8,
      });
    }

    return dependencies;
  }

  /**
   * 📋 Crear plan de ejecución
   */
  private async createExecutionPlan(
    subtasks: string[], 
    dependencies: Dependency[]
  ): Promise<ExecutionPlan> {
    const steps: ExecutionStep[] = subtasks.map((task, index) => ({
      id: `step_${index}`,
      task,
      order: index,
      estimatedTime: 1000, // 1 segundo por defecto
      dependencies: dependencies
        .filter(dep => dep.to === task)
        .map(dep => dep.from),
    }));

    return {
      steps,
      description: `Plan de ejecución con ${steps.length} pasos`,
      confidence: 0.9,
      reasoning: 'Plan creado basado en dependencias secuenciales',
    };
  }

  /**
   * ⚡ Ejecutar sub-tareas
   */
  private async executeSubtasks(
    steps: ExecutionStep[], 
    session: MCPSession
  ): Promise<ExecutionResult> {
    const results: SubtaskResult[] = [];
    const reasoningSteps: ReasoningStep[] = [];
    let overallConfidence = 1.0;

    for (const step of steps) {
      try {
        const startTime = Date.now();
        
        // Simular ejecución de sub-tarea
        const result = await this.executeSubtask(step, session);
        
        results.push(result);
        
        reasoningSteps.push({
          type: 'subtask_execution',
          description: `Ejecución: ${step.task}`,
          input: step.task,
          output: result.output,
          confidence: result.confidence,
          reasoning: result.reasoning,
        });

        overallConfidence *= result.confidence;

      } catch (error) {
        logger.error(`Error executing subtask ${step.task}:`, error);
        
        const errorResult: SubtaskResult = {
          stepId: step.id,
          success: false,
          output: 'Error en la ejecución',
          confidence: 0,
          reasoning: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
        
        results.push(errorResult);
        overallConfidence *= 0.5;
      }
    }

    return {
      results,
      steps: reasoningSteps,
      overallConfidence,
    };
  }

  /**
   * 🎯 Ejecutar sub-tarea individual
   */
  private async executeSubtask(
    step: ExecutionStep, 
    session: MCPSession
  ): Promise<SubtaskResult> {
    // Simulación de ejecución - en producción aquí iría la lógica específica
    const output = `Resultado de: ${step.task}`;
    
    return {
      stepId: step.id,
      success: true,
      output,
      confidence: 0.8,
      reasoning: `Sub-tarea ejecutada exitosamente: ${step.task}`,
    };
  }

  /**
   * 🔄 Sintetizar resultados
   */
  private async synthesizeResults(
    results: SubtaskResult[], 
    originalMessage: Message
  ): Promise<SynthesisResult> {
    const successfulResults = results.filter(r => r.success);
    const outputs = successfulResults.map(r => r.output);
    
    const summary = `Procesamiento completado: ${successfulResults.length}/${results.length} sub-tareas exitosas. ${outputs.join('. ')}`;
    
    const confidence = successfulResults.length / results.length;
    
    return {
      summary,
      confidence,
      reasoning: 'Síntesis basada en resultados de sub-tareas ejecutadas',
    };
  }

  /**
   * 💡 Generar recomendaciones
   */
  private async generateRecommendations(
    steps: ReasoningStep[], 
    analysis: RequestAnalysis, 
    session: MCPSession
  ): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // Recomendación basada en complejidad
    if (analysis.complexity > 0.8) {
      recommendations.push({
        type: 'optimization',
        title: 'Optimización de proceso',
        description: 'Considera dividir solicitudes complejas en pasos más pequeños para mejores resultados',
        confidence: 0.7,
        priority: 'medium',
      });
    }

    // Recomendación basada en dominio
    if (analysis.domain === 'automation') {
      recommendations.push({
        type: 'workflow',
        title: 'Automatización avanzada',
        description: 'Puedes crear workflows automatizados para repetir este proceso',
        confidence: 0.8,
        priority: 'high',
      });
    }

    return recommendations;
  }

  /**
   * 🚀 Generar recomendaciones simples
   */
  private async generateSimpleRecommendations(
    response: Message, 
    agent: Agent
  ): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // Recomendación basada en el agente usado
    recommendations.push({
      type: 'agent_suggestion',
      title: `Especialización en ${agent.role}`,
      description: `Para consultas similares, ${agent.name} es tu mejor opción`,
      confidence: 0.8,
      priority: 'low',
    });

    return recommendations;
  }

  /**
   * 🔍 Métodos auxiliares
   */
  private requiresComplexReasoning(analysis: RequestAnalysis): boolean {
    return analysis.complexity > 0.7 || 
           analysis.requiresMultiStep || 
           analysis.intents.length > 1;
  }

  private requiresExternalData(content: string): boolean {
    const externalDataKeywords = ['buscar', 'datos externos', 'api', 'web', 'información actual'];
    return externalDataKeywords.some(keyword => content.toLowerCase().includes(keyword));
  }

  private requiresUserInput(content: string): boolean {
    const userInputKeywords = ['pregunta', 'confirmar', 'elegir', 'seleccionar', 'preferencia'];
    return userInputKeywords.some(keyword => content.toLowerCase().includes(keyword));
  }

  private cacheResult(sessionId: string, messageId: string, result: ReasoningResult): void {
    const cacheKey = `${sessionId}_${messageId}`;
    this.reasoningCache.set(cacheKey, result);
    
    // Limpiar cache antiguo (mantener últimos 100 resultados)
    if (this.reasoningCache.size > 100) {
      const firstKey = this.reasoningCache.keys().next().value;
      this.reasoningCache.delete(firstKey);
    }
  }

  /**
   * 🎯 Configurar listeners de eventos
   */
  private setupEventListeners(): void {
    this.on('reasoningCompleted', ({ sessionId, result }) => {
      logger.debug(`🧠 Reasoning completed for session ${sessionId} with confidence ${result.confidence}`);
    });
  }
}

// Interfaces para el motor de razonamiento
interface RequestAnalysis {
  intents: Intent[];
  entities: Entity[];
  complexity: number;
  domain: string;
  contextualFactors: ContextualFactor[];
  requiresMultiStep: boolean;
  requiresExternalData: boolean;
  requiresUserInput: boolean;
}

interface ContextualFactor {
  type: string;
  value: any;
  impact: number;
  description: string;
}

interface ReasoningResult {
  success: boolean;
  confidence: number;
  reasoning: string;
  steps: ReasoningStep[];
  recommendations: Recommendation[];
  processingTime: number;
  error?: string;
  metadata?: Record<string, any>;
}

interface ReasoningStep {
  type: string;
  description: string;
  input: string;
  output: string;
  confidence: number;
  reasoning: string;
}

interface Recommendation {
  type: string;
  title: string;
  description: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high';
}

interface DecompositionResult {
  subtasks: string[];
  confidence: number;
  reasoning: string;
}

interface Dependency {
  from: string;
  to: string;
  type: 'sequential' | 'parallel' | 'conditional';
  description: string;
  strength: number;
}

interface ExecutionPlan {
  steps: ExecutionStep[];
  description: string;
  confidence: number;
  reasoning: string;
}

interface ExecutionStep {
  id: string;
  task: string;
  order: number;
  estimatedTime: number;
  dependencies: string[];
}

interface ExecutionResult {
  results: SubtaskResult[];
  steps: ReasoningStep[];
  overallConfidence: number;
}

interface SubtaskResult {
  stepId: string;
  success: boolean;
  output: string;
  confidence: number;
  reasoning: string;
}

interface SynthesisResult {
  summary: string;
  confidence: number;
  reasoning: string;
}

export default ReasoningEngine;

