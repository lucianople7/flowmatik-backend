# 🚀 Flowmatik Backend - Documentación Completa

## 📋 Resumen del Proyecto

Flowmatik Backend es una plataforma avanzada de creación de contenido impulsada por IA, construida con arquitectura enterprise y tecnologías de vanguardia.

### 🎯 Características Principales

- **🧠 IA Avanzada**: Sistema MCP (Model Context Protocol) con SiliconFlow y Doubao 1.5 Pro
- **💳 Pagos Duales**: Integración completa con Stripe y LemonSqueezy
- **🔐 Seguridad Enterprise**: Autenticación JWT, rate limiting, y permisos granulares
- **📊 Analytics Completos**: Tracking de uso, métricas en tiempo real, y billing automático
- **⚡ Real-time**: WebSocket para streaming y notificaciones
- **🚀 Production Ready**: Docker, monitoring, y health checks

## 🏗️ Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   Database      │
│   (React)       │◄──►│   (Express)     │◄──►│   (MySQL)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   Cache         │
                       │   (Redis)       │
                       └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   AI Services   │
                       │   (SiliconFlow) │
                       └─────────────────┘
```

### Servicios Implementados

1. **AuthService** - Autenticación y autorización
2. **AIIntegrationService** - Integración con IA
3. **PaymentService** - Gestión de pagos y subscripciones
4. **UsageTrackingService** - Tracking de uso y billing
5. **WebhookService** - Manejo de eventos de pago
6. **WebSocketService** - Comunicación en tiempo real
7. **ContextManager** - Gestión de contexto MCP
8. **AgentManager** - Orquestación de agentes IA
9. **ReasoningEngine** - Motor de razonamiento

## 🔧 Instalación y Configuración

### Requisitos Previos

- Node.js 18+
- MySQL 8.0+
- Redis 7+
- Docker (opcional)

### Instalación Local

```bash
# Clonar el repositorio
git clone https://github.com/flowmatik/backend.git
cd flowmatik-backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus configuraciones

# Ejecutar migraciones
npm run db:migrate

# Iniciar en modo desarrollo
npm run dev
```

### Instalación con Docker

```bash
# Construir y ejecutar
docker-compose up -d

# Ver logs
docker-compose logs -f flowmatik-api

# Parar servicios
docker-compose down
```

## 🔑 Variables de Entorno

```env
# Servidor
NODE_ENV=production
PORT=3000

# Base de datos
DATABASE_URL=mysql://user:password@localhost:3306/flowmatik

# Cache
REDIS_URL=redis://localhost:6379

# Autenticación
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# LemonSqueezy
LEMONSQUEEZY_API_KEY=your-api-key
LEMONSQUEEZY_WEBHOOK_SECRET=your-webhook-secret

# SiliconFlow
SILICONFLOW_API_KEY=your-api-key
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1

# Email (opcional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

## 📚 API Endpoints

### Autenticación

```
POST   /api/auth/register      # Registro de usuario
POST   /api/auth/login         # Login
POST   /api/auth/logout        # Logout
GET    /api/auth/me            # Perfil actual
PUT    /api/auth/profile       # Actualizar perfil
POST   /api/auth/change-password # Cambiar contraseña
POST   /api/auth/forgot-password # Recuperar contraseña
POST   /api/auth/reset-password  # Reset contraseña
```

### IA y Chat

```
POST   /api/ai/chat            # Chat con IA
POST   /api/ai/generate-content # Generar contenido multimedia
GET    /api/ai/models          # Modelos disponibles
GET    /api/ai/status          # Estado del servicio
GET    /api/ai/usage           # Analytics de uso
GET    /api/ai/conversations   # Historial de conversaciones
```

### Pagos y Subscripciones

```
GET    /api/payments/plans     # Planes disponibles
GET    /api/payments/subscription # Subscripción actual
POST   /api/payments/subscribe/stripe # Crear subscripción Stripe
POST   /api/payments/subscribe/lemonsqueezy # Crear subscripción LemonSqueezy
POST   /api/payments/subscription/cancel # Cancelar subscripción
GET    /api/payments/invoices  # Facturas
GET    /api/payments/payment-methods # Métodos de pago
```

### Administración

```
GET    /api/admin/dashboard    # Dashboard principal
GET    /api/admin/users        # Lista de usuarios
GET    /api/admin/metrics      # Métricas del sistema
GET    /api/admin/health       # Estado del sistema
POST   /api/admin/notifications # Enviar notificaciones
GET    /api/admin/logs         # Logs del sistema
```

### Webhooks

```
POST   /api/webhooks/stripe    # Webhooks de Stripe
POST   /api/webhooks/lemonsqueezy # Webhooks de LemonSqueezy
GET    /api/webhooks/stats     # Estadísticas de webhooks
POST   /api/webhooks/retry     # Reintentar webhooks fallidos
```

## 💰 Modelo de Precios

| Plan | Precio | Requests/día | Tokens/día | Características |
|------|--------|--------------|------------|-----------------|
| **Free** | $0 | 100 | 50K | Chat básico, soporte comunidad |
| **Starter** | $19/mes | 1,000 | 500K | Imágenes, soporte prioritario, API |
| **Pro** | $39/mes | 10,000 | 5M | Todo multimedia, analytics, workflows |
| **Business** | $79/mes | Unlimited | Unlimited | Todo incluido, SLA, integraciones |

## 🔒 Seguridad

### Características de Seguridad

- **Autenticación JWT** con expiración automática
- **Rate Limiting** por usuario e IP
- **CORS** configurado para dominios específicos
- **Headers de Seguridad** (Helmet.js)
- **Validación de Input** en todos los endpoints
- **Verificación de Webhooks** con firmas criptográficas
- **Encriptación de Contraseñas** con bcrypt
- **Variables de Entorno** para datos sensibles

### Roles y Permisos

- **user**: Usuario estándar con acceso básico
- **premium**: Usuario con plan de pago
- **admin**: Acceso completo al sistema

## 📊 Monitoring y Logs

### Health Checks

```bash
# Verificar estado del sistema
curl http://localhost:3000/health

# Respuesta esperada
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "environment": "production"
}
```

### Métricas Disponibles

- **Requests por segundo**
- **Tiempo de respuesta promedio**
- **Uso de CPU y memoria**
- **Conexiones activas**
- **Errores por endpoint**
- **Costos de IA por usuario**
- **Revenue en tiempo real**

### Logs Estructurados

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "service": "AIController",
  "message": "AI chat request processed",
  "userId": "user_123",
  "requestId": "req_456",
  "cost": 0.05,
  "tokens": 1500
}
```

## 🚀 Deployment

### Producción con Docker

```bash
# Construir imagen
docker build -t flowmatik-backend .

# Ejecutar con Docker Compose
docker-compose -f docker-compose.yml up -d

# Verificar servicios
docker-compose ps
```

### Deployment Manual

```bash
# Construir aplicación
npm run build

# Ejecutar en producción
npm run start:prod
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Build application
        run: npm run build
      - name: Deploy to server
        run: npm run deploy:production
```

## 🧪 Testing

### Ejecutar Tests

```bash
# Tests unitarios
npm test

# Tests con coverage
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

### Estructura de Tests

```
tests/
├── unit/           # Tests unitarios
├── integration/    # Tests de integración
├── e2e/           # Tests end-to-end
└── fixtures/      # Datos de prueba
```

## 🔧 Scripts Disponibles

```bash
# Desarrollo
npm run dev              # Servidor de desarrollo
npm run build           # Construir para producción
npm run start           # Iniciar servidor
npm run start:prod      # Iniciar en modo producción

# Testing
npm test                # Ejecutar tests
npm run test:watch      # Tests en modo watch
npm run test:coverage   # Tests con coverage

# Calidad de código
npm run lint            # Linting
npm run lint:fix        # Fix automático
npm run format          # Formatear código
npm run type-check      # Verificar tipos

# Base de datos
npm run db:migrate      # Ejecutar migraciones
npm run db:seed         # Poblar con datos
npm run db:reset        # Reset completo

# Deployment
npm run deploy:staging     # Deploy a staging
npm run deploy:production  # Deploy a producción

# Utilidades
npm run health:check    # Verificar salud
npm run logs:tail       # Ver logs en tiempo real
npm run backup:db       # Backup de base de datos
npm run clean           # Limpiar archivos temporales
```

## 🤝 Contribución

### Flujo de Desarrollo

1. Fork del repositorio
2. Crear rama feature: `git checkout -b feature/nueva-funcionalidad`
3. Commit cambios: `git commit -m 'Add nueva funcionalidad'`
4. Push a la rama: `git push origin feature/nueva-funcionalidad`
5. Crear Pull Request

### Estándares de Código

- **TypeScript** estricto
- **ESLint** para linting
- **Prettier** para formateo
- **Conventional Commits** para mensajes
- **Tests** obligatorios para nuevas funcionalidades

## 📞 Soporte

### Contacto

- **Email**: team@flowmatik.co
- **Website**: https://flowmatik.co
- **Documentation**: https://docs.flowmatik.co
- **GitHub**: https://github.com/flowmatik/backend

### Reportar Issues

1. Verificar que el issue no exista
2. Usar el template de issue
3. Incluir logs y pasos para reproducir
4. Etiquetar apropiadamente

## 📄 Licencia

MIT License - ver [LICENSE](LICENSE) para más detalles.

---

**¡Flowmatik Backend - Potenciando la creación de contenido con IA avanzada!** 🚀

