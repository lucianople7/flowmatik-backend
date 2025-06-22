// 🤖 FLOWMATIK MCP - AGENT MANAGER
// Gestiona los agentes inteligentes especializados

import { EventEmitter } from 'events';
import { 
  Agent, 
  AgentRole, 
  AgentPerformance, 
  Personality, 
  MCPSession, 
  Message, 
  MessageRole,
  ContentRequest,
  ContentResult,
  WorkflowStep,
  Intent
} from '@/types';
import { logger } from '@/utils/logger';
import { SiliconFlowService } from '@/services/siliconflow';
import { ContextManager } from '@/services/contextManager';
import { DatabaseService } from '@/services/database';

/**
 * 🎯 Agent Manager - Orquestador de agentes inteligentes
 * Gestiona múltiples agentes especializados con personalidades únicas
 */
export class AgentManager extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private activeAgents: Map<string, Agent> = new Map();
  private siliconflow: SiliconFlowService;
  private contextManager: ContextManager;
  private database: DatabaseService;

  constructor(contextManager: ContextManager) {
    super();
    this.contextManager = contextManager;
    this.siliconflow = new SiliconFlowService();
    this.database = new DatabaseService();
    
    this.initializeDefaultAgents();
    this.setupEventListeners();
    
    logger.info('🤖 AgentManager initialized');
  }

  /**
   * 🎯 Inicializar agentes por defecto
   */
  private initializeDefaultAgents(): void {
    const defaultAgents: Omit<Agent, 'id' | 'createdAt'>[] = [
      {
        name: 'FLOWI CEO',
        role: AgentRole.GENERAL_ASSISTANT,
        description: 'Asistente general inteligente y carismático, CEO virtual de Flowmatik',
        capabilities: [
          'conversacion_general',
          'gestion_proyectos',
          'toma_decisiones',
          'liderazgo',
          'estrategia_empresarial'
        ],
        model: 'doubao-1.5-pro-32k',
        personality: {
          tone: 'professional',
          style: 'conversational',
          expertise: ['business', 'leadership', 'strategy', 'innovation'],
          traits: ['carismático', 'visionario', 'empático', 'decisivo', 'inspirador']
        },
        isActive: true,
        performance: this.createDefaultPerformance(),
      },
      {
        name: 'Content Creator Pro',
        role: AgentRole.CONTENT_CREATOR,
        description: 'Especialista en creación de contenido multimodal de alta calidad',
        capabilities: [
          'generacion_texto',
          'generacion_imagenes',
          'generacion_videos',
          'copywriting',
          'storytelling',
          'seo_optimization'
        ],
        model: 'doubao-1.5-pro-32k',
        personality: {
          tone: 'creative',
          style: 'detailed',
          expertise: ['content', 'marketing', 'design', 'storytelling'],
          traits: ['creativo', 'detallista', 'innovador', 'persuasivo']
        },
        isActive: true,
        performance: this.createDefaultPerformance(),
      },
      {
        name: 'Data Analyst Expert',
        role: AgentRole.DATA_ANALYST,
        description: 'Analista de datos avanzado con capacidades de insights profundos',
        capabilities: [
          'analisis_datos',
          'visualizacion',
          'predicciones',
          'reportes',
          'metricas',
          'business_intelligence'
        ],
        model: 'doubao-1.5-pro-32k',
        personality: {
          tone: 'technical',
          style: 'detailed',
          expertise: ['data', 'analytics', 'statistics', 'visualization'],
          traits: ['analítico', 'preciso', 'metódico', 'objetivo']
        },
        isActive: true,
        performance: this.createDefaultPerformance(),
      },
      {
        name: 'Customer Support Specialist',
        role: AgentRole.CUSTOMER_SUPPORT,
        description: 'Especialista en atención al cliente con empatía y resolución efectiva',
        capabilities: [
          'atencion_cliente',
          'resolucion_problemas',
          'documentacion',
          'escalamiento',
          'satisfaccion_cliente'
        ],
        model: 'doubao-1.5-pro-32k',
        personality: {
          tone: 'friendly',
          style: 'conversational',
          expertise: ['customer_service', 'problem_solving', 'communication'],
          traits: ['empático', 'paciente', 'resolutivo', 'amable']
        },
        isActive: true,
        performance: this.createDefaultPerformance(),
      },
      {
        name: 'Workflow Optimizer',
        role: AgentRole.WORKFLOW_MANAGER,
        description: 'Optimizador de workflows y procesos automatizados',
        capabilities: [
          'optimizacion_procesos',
          'automatizacion',
          'workflow_design',
          'eficiencia',
          'integraciones'
        ],
        model: 'doubao-1.5-pro-32k',
        personality: {
          tone: 'technical',
          style: 'concise',
          expertise: ['automation', 'processes', 'optimization', 'integration'],
          traits: ['eficiente', 'sistemático', 'innovador', 'práctico']
        },
        isActive: true,
        performance: this.createDefaultPerformance(),
      },
      {
        name: 'Terminal Assistant',
        role: AgentRole.TERMINAL_ASSISTANT,
        description: 'Asistente especializado para interfaz de terminal con capacidades técnicas',
        capabilities: [
          'comandos_sistema',
          'debugging',
          'administracion',
          'monitoreo',
          'troubleshooting'
        ],
        model: 'doubao-1.5-pro-32k',
        personality: {
          tone: 'technical',
          style: 'concise',
          expertise: ['system_admin', 'debugging', 'monitoring', 'security'],
          traits: ['técnico', 'preciso', 'confiable', 'eficiente']
        },
        isActive: true,
        performance: this.createDefaultPerformance(),
      }
    ];

    // Crear y registrar agentes
    defaultAgents.forEach(agentData => {
      const agent: Agent = {
        ...agentData,
        id: this.generateAgentId(agentData.role),
        createdAt: new Date(),
      };
      
      this.agents.set(agent.id, agent);
      this.activeAgents.set(agent.role, agent);
    });

    logger.info(`✅ Initialized ${defaultAgents.length} default agents`);
  }

  /**
   * 🎯 Seleccionar el mejor agente para una tarea
   */
  async selectBestAgent(
    sessionId: string, 
    message: Message, 
    intent?: Intent
  ): Promise<Agent> {
    const session = await this.contextManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Analizar el contexto y determinar el mejor agente
    const agentRole = await this.determineOptimalAgentRole(message, intent, session);
    
    // Obtener el agente activo para ese rol
    let agent = this.activeAgents.get(agentRole);
    
    if (!agent) {
      // Fallback al asistente general
      agent = this.activeAgents.get(AgentRole.GENERAL_ASSISTANT);
    }

    if (!agent) {
      throw new Error('No suitable agent found');
    }

    // Actualizar métricas del agente
    await this.updateAgentMetrics(agent.id, 'selection');

    this.emit('agentSelected', { agent, sessionId, message });
    logger.info(`🎯 Selected agent: ${agent.name} for session: ${sessionId}`);

    return agent;
  }

  /**
   * 🧠 Determinar el rol de agente óptimo
   */
  private async determineOptimalAgentRole(
    message: Message, 
    intent?: Intent, 
    session?: MCPSession
  ): Promise<AgentRole> {
    const content = message.content.toLowerCase();
    
    // Análisis basado en palabras clave y contexto
    if (this.isContentCreationRequest(content)) {
      return AgentRole.CONTENT_CREATOR;
    }
    
    if (this.isDataAnalysisRequest(content)) {
      return AgentRole.DATA_ANALYST;
    }
    
    if (this.isCustomerSupportRequest(content)) {
      return AgentRole.CUSTOMER_SUPPORT;
    }
    
    if (this.isWorkflowRequest(content)) {
      return AgentRole.WORKFLOW_MANAGER;
    }
    
    if (this.isTerminalRequest(content, session)) {
      return AgentRole.TERMINAL_ASSISTANT;
    }

    // Análisis basado en intent
    if (intent) {
      const roleFromIntent = this.mapIntentToAgentRole(intent);
      if (roleFromIntent) {
        return roleFromIntent;
      }
    }

    // Default: asistente general
    return AgentRole.GENERAL_ASSISTANT;
  }

  /**
   * 🎨 Detectar solicitudes de creación de contenido
   */
  private isContentCreationRequest(content: string): boolean {
    const contentKeywords = [
      'crear', 'generar', 'escribir', 'diseñar', 'imagen', 'video', 
      'artículo', 'blog', 'post', 'contenido', 'copy', 'texto',
      'historia', 'guión', 'descripción', 'marketing'
    ];
    
    return contentKeywords.some(keyword => content.includes(keyword));
  }

  /**
   * 📊 Detectar solicitudes de análisis de datos
   */
  private isDataAnalysisRequest(content: string): boolean {
    const dataKeywords = [
      'analizar', 'datos', 'estadísticas', 'métricas', 'reporte',
      'gráfico', 'dashboard', 'tendencias', 'insights', 'kpi',
      'performance', 'resultados', 'comparar', 'evaluar'
    ];
    
    return dataKeywords.some(keyword => content.includes(keyword));
  }

  /**
   * 🎧 Detectar solicitudes de soporte
   */
  private isCustomerSupportRequest(content: string): boolean {
    const supportKeywords = [
      'ayuda', 'problema', 'error', 'no funciona', 'soporte',
      'asistencia', 'duda', 'consulta', 'resolver', 'solución',
      'bug', 'fallo', 'issue', 'ticket'
    ];
    
    return supportKeywords.some(keyword => content.includes(keyword));
  }

  /**
   * 🔄 Detectar solicitudes de workflow
   */
  private isWorkflowRequest(content: string): boolean {
    const workflowKeywords = [
      'automatizar', 'workflow', 'proceso', 'flujo', 'integrar',
      'conectar', 'optimizar', 'eficiencia', 'automatización',
      'pipeline', 'secuencia', 'rutina'
    ];
    
    return workflowKeywords.some(keyword => content.includes(keyword));
  }

  /**
   * 💻 Detectar solicitudes de terminal
   */
  private isTerminalRequest(content: string, session?: MCPSession): boolean {
    const terminalKeywords = [
      'comando', 'terminal', 'shell', 'bash', 'script',
      'servidor', 'sistema', 'logs', 'monitoreo', 'debug'
    ];
    
    const hasTerminalKeywords = terminalKeywords.some(keyword => content.includes(keyword));
    const isTerminalSession = session?.type === 'terminal';
    
    return hasTerminalKeywords || isTerminalSession;
  }

  /**
   * 🎯 Mapear intent a rol de agente
   */
  private mapIntentToAgentRole(intent: Intent): AgentRole | null {
    const intentToRoleMap: Record<string, AgentRole> = {
      'create_content': AgentRole.CONTENT_CREATOR,
      'analyze_data': AgentRole.DATA_ANALYST,
      'get_support': AgentRole.CUSTOMER_SUPPORT,
      'optimize_workflow': AgentRole.WORKFLOW_MANAGER,
      'terminal_command': AgentRole.TERMINAL_ASSISTANT,
    };

    return intentToRoleMap[intent.name] || null;
  }

  /**
   * 💬 Procesar mensaje con agente seleccionado
   */
  async processWithAgent(
    agent: Agent, 
    sessionId: string, 
    message: Message
  ): Promise<Message> {
    const startTime = Date.now();
    
    try {
      // Obtener contexto relevante
      const session = await this.contextManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // Preparar prompt personalizado para el agente
      const systemPrompt = this.buildAgentSystemPrompt(agent, session);
      const contextualPrompt = await this.buildContextualPrompt(agent, session, message);

      // Generar respuesta usando SiliconFlow
      const response = await this.siliconflow.generateText({
        model: agent.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextualPrompt }
        ],
        temperature: this.getTemperatureForAgent(agent),
        max_tokens: 2000,
      });

      // Crear mensaje de respuesta
      const responseMessage: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId,
        role: MessageRole.ASSISTANT,
        content: response.content,
        metadata: {
          model: agent.model,
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
          tokens: response.usage?.total_tokens,
          cost: response.cost,
          processingTime: Date.now() - startTime,
          confidence: 0.9,
        },
        timestamp: new Date(),
      };

      // Actualizar métricas del agente
      await this.updateAgentMetrics(agent.id, 'response', {
        processingTime: Date.now() - startTime,
        success: true,
      });

      this.emit('agentResponse', { agent, message: responseMessage, sessionId });
      
      return responseMessage;

    } catch (error) {
      logger.error(`Error processing with agent ${agent.name}:`, error);
      
      // Actualizar métricas de error
      await this.updateAgentMetrics(agent.id, 'error');

      // Crear mensaje de error
      const errorMessage: Message = {
        id: `msg_error_${Date.now()}`,
        sessionId,
        role: MessageRole.ASSISTANT,
        content: 'Lo siento, he tenido un problema procesando tu solicitud. ¿Podrías intentarlo de nuevo?',
        metadata: {
          error: true,
          agentId: agent.id,
          processingTime: Date.now() - startTime,
        },
        timestamp: new Date(),
      };

      return errorMessage;
    }
  }

  /**
   * 🎭 Construir prompt del sistema para el agente
   */
  private buildAgentSystemPrompt(agent: Agent, session: MCPSession): string {
    const personality = agent.personality;
    const capabilities = agent.capabilities.join(', ');
    const userPrefs = session.context.userPreferences;

    return `Eres ${agent.name}, ${agent.description}.

PERSONALIDAD:
- Tono: ${personality.tone}
- Estilo: ${personality.style}
- Especialidades: ${personality.expertise.join(', ')}
- Características: ${personality.traits.join(', ')}

CAPACIDADES:
${capabilities}

PREFERENCIAS DEL USUARIO:
- Idioma: ${userPrefs.language}
- Estilo de respuesta: ${userPrefs.ai.responseStyle}
- Nivel de creatividad: ${userPrefs.ai.creativity}
- Nivel de formalidad: ${userPrefs.ai.formality}

INSTRUCCIONES:
1. Mantén tu personalidad y especialización en todo momento
2. Adapta tu respuesta a las preferencias del usuario
3. Sé útil, preciso y relevante
4. Si la solicitud está fuera de tu especialidad, sugiere el agente apropiado
5. Usa ejemplos prácticos cuando sea apropiado
6. Mantén un tono ${personality.tone} y estilo ${personality.style}

Responde siempre en español a menos que se solicite específicamente otro idioma.`;
  }

  /**
   * 📝 Construir prompt contextual
   */
  private async buildContextualPrompt(
    agent: Agent, 
    session: MCPSession, 
    message: Message
  ): string {
    // Obtener contexto relevante
    const relevantContext = await this.contextManager.findRelevantContext(
      session.id, 
      message.content, 
      3
    );

    // Obtener historial reciente
    const recentHistory = session.context.conversationHistory
      .slice(-5)
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    let prompt = `CONTEXTO RELEVANTE:\n`;
    
    if (relevantContext.length > 0) {
      prompt += relevantContext
        .map(ctx => `- ${ctx.title}: ${ctx.content.substring(0, 200)}...`)
        .join('\n');
    } else {
      prompt += 'No hay contexto específico relevante.';
    }

    if (recentHistory) {
      prompt += `\n\nHISTORIAL RECIENTE:\n${recentHistory}`;
    }

    prompt += `\n\nSOLICITUD ACTUAL:\n${message.content}`;

    return prompt;
  }

  /**
   * 🌡️ Obtener temperatura para el agente
   */
  private getTemperatureForAgent(agent: Agent): number {
    const temperatureMap: Record<AgentRole, number> = {
      [AgentRole.CONTENT_CREATOR]: 0.8,
      [AgentRole.DATA_ANALYST]: 0.3,
      [AgentRole.CUSTOMER_SUPPORT]: 0.5,
      [AgentRole.WORKFLOW_MANAGER]: 0.4,
      [AgentRole.TERMINAL_ASSISTANT]: 0.2,
      [AgentRole.GENERAL_ASSISTANT]: 0.6,
    };

    return temperatureMap[agent.role] || 0.6;
  }

  /**
   * 📊 Actualizar métricas del agente
   */
  private async updateAgentMetrics(
    agentId: string, 
    action: 'selection' | 'response' | 'error',
    data?: any
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    switch (action) {
      case 'selection':
        agent.performance.totalInteractions++;
        break;
        
      case 'response':
        if (data?.success) {
          agent.performance.successRate = 
            (agent.performance.successRate * (agent.performance.totalInteractions - 1) + 1) / 
            agent.performance.totalInteractions;
        }
        
        if (data?.processingTime) {
          agent.performance.averageResponseTime = 
            (agent.performance.averageResponseTime + data.processingTime) / 2;
        }
        break;
        
      case 'error':
        agent.performance.successRate = 
          (agent.performance.successRate * (agent.performance.totalInteractions - 1)) / 
          agent.performance.totalInteractions;
        break;
    }

    agent.performance.lastUpdated = new Date();
    
    // Persistir en base de datos
    await this.database.updateAgentPerformance(agentId, agent.performance);
  }

  /**
   * 🎯 Obtener agente por ID
   */
  getAgent(agentId: string): Agent | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * 📋 Obtener todos los agentes activos
   */
  getActiveAgents(): Agent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * 📊 Obtener métricas de rendimiento
   */
  getPerformanceMetrics(): Record<string, AgentPerformance> {
    const metrics: Record<string, AgentPerformance> = {};
    
    this.agents.forEach((agent, id) => {
      metrics[id] = agent.performance;
    });

    return metrics;
  }

  /**
   * 🔧 Métodos auxiliares
   */
  private generateAgentId(role: AgentRole): string {
    return `agent_${role}_${Date.now()}`;
  }

  private createDefaultPerformance(): AgentPerformance {
    return {
      totalInteractions: 0,
      averageRating: 0,
      successRate: 1.0,
      averageResponseTime: 0,
      lastUpdated: new Date(),
    };
  }

  /**
   * 🎯 Configurar listeners de eventos
   */
  private setupEventListeners(): void {
    this.on('agentSelected', ({ agent, sessionId }) => {
      logger.debug(`🎯 Agent ${agent.name} selected for session ${sessionId}`);
    });

    this.on('agentResponse', ({ agent, message, sessionId }) => {
      logger.debug(`💬 Agent ${agent.name} responded in session ${sessionId}`);
    });
  }
}

export default AgentManager;

