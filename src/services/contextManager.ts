// 🧠 FLOWMATIK MCP - CONTEXT MANAGER
// Gestiona el contexto inteligente y la memoria de las conversaciones

import { EventEmitter } from 'events';
import { 
  MCPSession, 
  MCPContext, 
  MCPMemory, 
  Message, 
  Intent, 
  Entity, 
  Pattern,
  Preference,
  ConversationSummary,
  Knowledge,
  SessionType,
  MessageRole 
} from '@/types';
import { logger } from '@/utils/logger';
import { RedisService } from '@/services/redis';
import { DatabaseService } from '@/services/database';
import { EmbeddingService } from '@/services/embedding';

/**
 * 🎯 Context Manager - Cerebro del sistema MCP
 * Gestiona contexto, memoria y comprensión inteligente
 */
export class ContextManager extends EventEmitter {
  private redis: RedisService;
  private database: DatabaseService;
  private embedding: EmbeddingService;
  private activeSessions: Map<string, MCPSession> = new Map();
  private contextCache: Map<string, MCPContext> = new Map();

  constructor() {
    super();
    this.redis = new RedisService();
    this.database = new DatabaseService();
    this.embedding = new EmbeddingService();
    
    this.setupEventListeners();
    logger.info('🧠 ContextManager initialized');
  }

  /**
   * 🎯 Crear nueva sesión MCP
   */
  async createSession(
    userId: string, 
    type: SessionType, 
    metadata?: Record<string, any>
  ): Promise<MCPSession> {
    const sessionId = this.generateSessionId();
    
    const session: MCPSession = {
      id: sessionId,
      userId,
      type,
      context: await this.initializeContext(userId),
      memory: await this.initializeMemory(userId),
      agents: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Guardar en memoria y cache
    this.activeSessions.set(sessionId, session);
    await this.redis.setSession(sessionId, session);
    
    // Persistir en base de datos
    await this.database.createSession(session);

    this.emit('sessionCreated', session);
    logger.info(`🎯 Session created: ${sessionId} for user: ${userId}`);
    
    return session;
  }

  /**
   * 🔄 Actualizar contexto de sesión
   */
  async updateContext(
    sessionId: string, 
    message: Message, 
    intent?: Intent, 
    entities?: Entity[]
  ): Promise<MCPContext> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Actualizar historial de conversación
    session.context.conversationHistory.push(message);

    // Actualizar intent actual
    if (intent) {
      session.context.currentIntent = intent;
    }

    // Actualizar entidades
    if (entities) {
      session.context.entities = [...session.context.entities, ...entities];
    }

    // Actualizar metadata
    session.context.metadata = {
      ...session.context.metadata,
      lastMessageAt: new Date(),
      messageCount: session.context.conversationHistory.length,
    };

    // Procesar memoria a largo plazo
    await this.processLongTermMemory(session, message);

    // Limpiar historial si es muy largo
    await this.optimizeConversationHistory(session);

    // Guardar cambios
    session.updatedAt = new Date();
    this.activeSessions.set(sessionId, session);
    await this.redis.setSession(sessionId, session);
    await this.database.updateSession(session);

    this.emit('contextUpdated', session.context);
    
    return session.context;
  }

  /**
   * 🧠 Procesar memoria a largo plazo
   */
  private async processLongTermMemory(session: MCPSession, message: Message): Promise<void> {
    try {
      // Detectar patrones de comportamiento
      const patterns = await this.detectPatterns(session.context.conversationHistory);
      session.memory.longTerm.userPatterns = [...session.memory.longTerm.userPatterns, ...patterns];

      // Extraer preferencias del usuario
      const preferences = await this.extractPreferences(message);
      session.memory.longTerm.learnedPreferences = [
        ...session.memory.longTerm.learnedPreferences, 
        ...preferences
      ];

      // Crear resumen de conversación si es necesario
      if (session.context.conversationHistory.length % 20 === 0) {
        const summary = await this.createConversationSummary(session);
        session.memory.longTerm.conversationSummaries.push(summary);
      }

      // Actualizar base de conocimiento
      await this.updateKnowledgeBase(session, message);

    } catch (error) {
      logger.error('Error processing long-term memory:', error);
    }
  }

  /**
   * 🔍 Detectar patrones de comportamiento
   */
  private async detectPatterns(history: Message[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    
    // Analizar patrones temporales
    const timePatterns = this.analyzeTimePatterns(history);
    patterns.push(...timePatterns);

    // Analizar patrones de contenido
    const contentPatterns = await this.analyzeContentPatterns(history);
    patterns.push(...contentPatterns);

    // Analizar patrones de intención
    const intentPatterns = this.analyzeIntentPatterns(history);
    patterns.push(...intentPatterns);

    return patterns;
  }

  /**
   * ⏰ Analizar patrones temporales
   */
  private analyzeTimePatterns(history: Message[]): Pattern[] {
    const patterns: Pattern[] = [];
    const hourCounts: Record<number, number> = {};

    // Contar mensajes por hora
    history.forEach(msg => {
      const hour = new Date(msg.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    // Encontrar horas más activas
    const sortedHours = Object.entries(hourCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);

    sortedHours.forEach(([hour, count]) => {
      patterns.push({
        id: `time_${hour}`,
        type: 'temporal',
        pattern: `active_hour_${hour}`,
        frequency: count,
        lastSeen: new Date(),
      });
    });

    return patterns;
  }

  /**
   * 📝 Analizar patrones de contenido
   */
  private async analyzeContentPatterns(history: Message[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    const topicCounts: Record<string, number> = {};

    // Extraer temas principales usando embeddings
    for (const message of history.slice(-10)) { // Últimos 10 mensajes
      try {
        const topics = await this.extractTopics(message.content);
        topics.forEach(topic => {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        });
      } catch (error) {
        logger.warn('Error extracting topics:', error);
      }
    }

    // Crear patrones de temas frecuentes
    Object.entries(topicCounts)
      .filter(([, count]) => count >= 2)
      .forEach(([topic, count]) => {
        patterns.push({
          id: `topic_${topic}`,
          type: 'content',
          pattern: `frequent_topic_${topic}`,
          frequency: count,
          lastSeen: new Date(),
        });
      });

    return patterns;
  }

  /**
   * 🎯 Analizar patrones de intención
   */
  private analyzeIntentPatterns(history: Message[]): Pattern[] {
    const patterns: Pattern[] = [];
    const intentCounts: Record<string, number> = {};

    // Contar intenciones en metadata
    history.forEach(msg => {
      if (msg.metadata?.intent) {
        const intent = msg.metadata.intent;
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
      }
    });

    // Crear patrones de intenciones frecuentes
    Object.entries(intentCounts)
      .filter(([, count]) => count >= 2)
      .forEach(([intent, count]) => {
        patterns.push({
          id: `intent_${intent}`,
          type: 'intent',
          pattern: `frequent_intent_${intent}`,
          frequency: count,
          lastSeen: new Date(),
        });
      });

    return patterns;
  }

  /**
   * 💡 Extraer preferencias del usuario
   */
  private async extractPreferences(message: Message): Promise<Preference[]> {
    const preferences: Preference[] = [];
    
    // Analizar preferencias de estilo
    const stylePrefs = this.extractStylePreferences(message.content);
    preferences.push(...stylePrefs);

    // Analizar preferencias de formato
    const formatPrefs = this.extractFormatPreferences(message.content);
    preferences.push(...formatPrefs);

    // Analizar preferencias de contenido
    const contentPrefs = await this.extractContentPreferences(message.content);
    preferences.push(...contentPrefs);

    return preferences;
  }

  /**
   * 🎨 Extraer preferencias de estilo
   */
  private extractStylePreferences(content: string): Preference[] {
    const preferences: Preference[] = [];
    
    // Detectar preferencias de formalidad
    const formalWords = ['por favor', 'gracias', 'disculpe', 'cordialmente'];
    const casualWords = ['hola', 'hey', 'genial', 'perfecto'];
    
    const formalCount = formalWords.filter(word => 
      content.toLowerCase().includes(word)
    ).length;
    
    const casualCount = casualWords.filter(word => 
      content.toLowerCase().includes(word)
    ).length;

    if (formalCount > casualCount) {
      preferences.push({
        key: 'communication_style',
        value: 'formal',
        confidence: formalCount / (formalCount + casualCount),
        source: 'message_analysis',
        updatedAt: new Date(),
      });
    } else if (casualCount > formalCount) {
      preferences.push({
        key: 'communication_style',
        value: 'casual',
        confidence: casualCount / (formalCount + casualCount),
        source: 'message_analysis',
        updatedAt: new Date(),
      });
    }

    return preferences;
  }

  /**
   * 📋 Extraer preferencias de formato
   */
  private extractFormatPreferences(content: string): Preference[] {
    const preferences: Preference[] = [];
    
    // Detectar preferencia por listas
    if (content.includes('•') || content.includes('-') || content.includes('1.')) {
      preferences.push({
        key: 'format_preference',
        value: 'lists',
        confidence: 0.8,
        source: 'format_analysis',
        updatedAt: new Date(),
      });
    }

    // Detectar preferencia por explicaciones detalladas
    if (content.length > 200) {
      preferences.push({
        key: 'response_length',
        value: 'detailed',
        confidence: 0.7,
        source: 'length_analysis',
        updatedAt: new Date(),
      });
    } else if (content.length < 50) {
      preferences.push({
        key: 'response_length',
        value: 'concise',
        confidence: 0.7,
        source: 'length_analysis',
        updatedAt: new Date(),
      });
    }

    return preferences;
  }

  /**
   * 📚 Extraer preferencias de contenido
   */
  private async extractContentPreferences(content: string): Promise<Preference[]> {
    const preferences: Preference[] = [];
    
    try {
      // Usar embeddings para detectar temas de interés
      const topics = await this.extractTopics(content);
      
      topics.forEach(topic => {
        preferences.push({
          key: 'interest_topic',
          value: topic,
          confidence: 0.6,
          source: 'topic_analysis',
          updatedAt: new Date(),
        });
      });
    } catch (error) {
      logger.warn('Error extracting content preferences:', error);
    }

    return preferences;
  }

  /**
   * 📊 Crear resumen de conversación
   */
  private async createConversationSummary(session: MCPSession): Promise<ConversationSummary> {
    const history = session.context.conversationHistory;
    const recentMessages = history.slice(-20); // Últimos 20 mensajes

    // Crear resumen usando IA
    const summaryText = await this.generateSummary(recentMessages);
    
    // Extraer temas clave
    const keyTopics = await this.extractKeyTopics(recentMessages);
    
    // Analizar sentimiento
    const sentiment = await this.analyzeSentiment(recentMessages);
    
    // Calcular importancia
    const importance = this.calculateImportance(recentMessages);

    return {
      id: `summary_${Date.now()}`,
      sessionId: session.id,
      summary: summaryText,
      keyTopics,
      sentiment,
      importance,
      createdAt: new Date(),
    };
  }

  /**
   * 🔄 Optimizar historial de conversación
   */
  private async optimizeConversationHistory(session: MCPSession): Promise<void> {
    const maxMessages = 100;
    const history = session.context.conversationHistory;

    if (history.length > maxMessages) {
      // Mantener mensajes recientes y importantes
      const recentMessages = history.slice(-50);
      const importantMessages = history
        .slice(0, -50)
        .filter(msg => this.isImportantMessage(msg));

      session.context.conversationHistory = [
        ...importantMessages.slice(-20), // Máximo 20 mensajes importantes
        ...recentMessages
      ];

      logger.info(`🔄 Optimized conversation history for session: ${session.id}`);
    }
  }

  /**
   * ⭐ Determinar si un mensaje es importante
   */
  private isImportantMessage(message: Message): boolean {
    // Criterios de importancia
    const hasHighConfidence = (message.metadata?.confidence || 0) > 0.8;
    const hasEntities = (message.metadata?.entities?.length || 0) > 0;
    const isLongMessage = message.content.length > 100;
    const hasSpecialKeywords = /importante|urgente|problema|error|ayuda/i.test(message.content);

    return hasHighConfidence || hasEntities || isLongMessage || hasSpecialKeywords;
  }

  /**
   * 🎯 Obtener sesión activa
   */
  async getSession(sessionId: string): Promise<MCPSession | null> {
    // Buscar en memoria primero
    let session = this.activeSessions.get(sessionId);
    
    if (!session) {
      // Buscar en Redis
      session = await this.redis.getSession(sessionId);
      
      if (session) {
        this.activeSessions.set(sessionId, session);
      }
    }

    return session || null;
  }

  /**
   * 🔍 Buscar contexto relevante
   */
  async findRelevantContext(
    sessionId: string, 
    query: string, 
    limit: number = 5
  ): Promise<Knowledge[]> {
    const session = await this.getSession(sessionId);
    if (!session) return [];

    // Buscar en base de conocimiento usando embeddings
    const queryEmbedding = await this.embedding.generateEmbedding(query);
    const relevantKnowledge = await this.database.findSimilarKnowledge(
      queryEmbedding, 
      limit
    );

    // Buscar en memoria de la sesión
    const sessionKnowledge = session.memory.longTerm.knowledgeBase
      .filter(k => this.isRelevantToQuery(k, query))
      .slice(0, limit);

    return [...relevantKnowledge, ...sessionKnowledge];
  }

  /**
   * 🎯 Configurar listeners de eventos
   */
  private setupEventListeners(): void {
    this.on('sessionCreated', (session: MCPSession) => {
      logger.info(`📊 New session metrics: ${session.id}`);
    });

    this.on('contextUpdated', (context: MCPContext) => {
      logger.debug(`🔄 Context updated: ${context.conversationHistory.length} messages`);
    });
  }

  /**
   * 🔧 Métodos auxiliares
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async initializeContext(userId: string): Promise<MCPContext> {
    const userPreferences = await this.database.getUserPreferences(userId);
    
    return {
      conversationHistory: [],
      userPreferences: userPreferences || {
        language: 'es',
        timezone: 'UTC',
        theme: 'auto',
        notifications: {
          email: true,
          push: true,
          sms: false,
          frequency: 'immediate',
        },
        ai: {
          preferredModel: 'doubao-1.5-pro-32k',
          responseStyle: 'balanced',
          creativity: 0.7,
          formality: 0.5,
        },
      },
      currentIntent: {
        name: 'general',
        confidence: 1.0,
        parameters: {},
        context: [],
      },
      entities: [],
      metadata: {},
    };
  }

  private async initializeMemory(userId: string): Promise<MCPMemory> {
    const existingMemory = await this.database.getUserMemory(userId);
    
    return existingMemory || {
      shortTerm: new Map(),
      longTerm: {
        userPatterns: [],
        learnedPreferences: [],
        conversationSummaries: [],
        knowledgeBase: [],
      },
    };
  }

  private async extractTopics(content: string): Promise<string[]> {
    // Implementación simplificada - en producción usar NLP avanzado
    const words = content.toLowerCase().split(/\s+/);
    const stopWords = new Set(['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'al', 'del', 'los', 'las']);
    
    const topics = words
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 5);

    return topics;
  }

  private async generateSummary(messages: Message[]): Promise<string> {
    // Implementación simplificada - en producción usar IA
    const content = messages.map(m => m.content).join(' ');
    return `Resumen de conversación con ${messages.length} mensajes sobre: ${content.substring(0, 100)}...`;
  }

  private async extractKeyTopics(messages: Message[]): Promise<string[]> {
    const allContent = messages.map(m => m.content).join(' ');
    return this.extractTopics(allContent);
  }

  private async analyzeSentiment(messages: Message[]): Promise<number> {
    // Implementación simplificada - retorna valor entre -1 y 1
    const positiveWords = ['bueno', 'excelente', 'perfecto', 'genial', 'gracias'];
    const negativeWords = ['malo', 'error', 'problema', 'difícil', 'no funciona'];
    
    let score = 0;
    const allContent = messages.map(m => m.content).join(' ').toLowerCase();
    
    positiveWords.forEach(word => {
      if (allContent.includes(word)) score += 0.1;
    });
    
    negativeWords.forEach(word => {
      if (allContent.includes(word)) score -= 0.1;
    });
    
    return Math.max(-1, Math.min(1, score));
  }

  private calculateImportance(messages: Message[]): number {
    // Calcular importancia basada en longitud, entidades, etc.
    const avgLength = messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length;
    const hasEntities = messages.some(m => (m.metadata?.entities?.length || 0) > 0);
    
    let importance = 0.5; // Base
    
    if (avgLength > 100) importance += 0.2;
    if (hasEntities) importance += 0.3;
    
    return Math.min(1, importance);
  }

  private isRelevantToQuery(knowledge: Knowledge, query: string): boolean {
    const queryLower = query.toLowerCase();
    const titleMatch = knowledge.title.toLowerCase().includes(queryLower);
    const contentMatch = knowledge.content.toLowerCase().includes(queryLower);
    const tagMatch = knowledge.tags.some(tag => tag.toLowerCase().includes(queryLower));
    
    return titleMatch || contentMatch || tagMatch;
  }

  private async updateKnowledgeBase(session: MCPSession, message: Message): Promise<void> {
    // Extraer conocimiento valioso del mensaje
    if (message.content.length > 50 && message.role === MessageRole.USER) {
      const topics = await this.extractTopics(message.content);
      
      if (topics.length > 0) {
        const knowledge: Knowledge = {
          id: `knowledge_${Date.now()}`,
          title: `User query about ${topics[0]}`,
          content: message.content,
          type: 'user_preference' as any,
          tags: topics,
          confidence: 0.7,
          source: 'conversation',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        session.memory.longTerm.knowledgeBase.push(knowledge);
      }
    }
  }
}

export default ContextManager;

