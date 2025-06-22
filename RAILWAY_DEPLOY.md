# 🚀 Guía de Deployment en Railway - Flowmatik Backend

## 📋 Preparación Previa

### 1. Crear cuenta en Railway
- Ve a [railway.app](https://railway.app)
- Regístrate con GitHub (recomendado)
- Verifica tu email

### 2. Instalar Railway CLI
```bash
npm install -g @railway/cli
```

### 3. Preparar repositorio GitHub
```bash
# Si no tienes repo, créalo
git init
git add .
git commit -m "Initial commit: Flowmatik Backend"
git branch -M main
git remote add origin https://github.com/tu-usuario/flowmatik-backend.git
git push -u origin main
```

## 🚀 Deployment Automático

### Opción 1: Script Automático (Recomendado)
```bash
# Ejecutar script de deployment
./scripts/deploy-railway.sh
```

### Opción 2: Deployment Manual

#### Paso 1: Login en Railway
```bash
railway login
```

#### Paso 2: Crear proyecto
```bash
railway init
# Selecciona "Empty Project"
# Nombra tu proyecto: "flowmatik-backend"
```

#### Paso 3: Conectar con GitHub
```bash
railway connect
# Selecciona tu repositorio de GitHub
```

#### Paso 4: Agregar servicios de base de datos
```bash
# Agregar MySQL
railway add mysql

# Agregar Redis
railway add redis
```

#### Paso 5: Configurar variables de entorno
```bash
# Variables básicas
railway variables set NODE_ENV=production
railway variables set PORT=\$PORT

# JWT (genera uno seguro)
railway variables set JWT_SECRET="tu-jwt-secret-super-seguro-aqui"

# Stripe
railway variables set STRIPE_SECRET_KEY="sk_live_tu_stripe_key"
railway variables set STRIPE_WEBHOOK_SECRET="whsec_tu_webhook_secret"

# LemonSqueezy
railway variables set LEMONSQUEEZY_API_KEY="tu_lemonsqueezy_key"
railway variables set LEMONSQUEEZY_WEBHOOK_SECRET="tu_webhook_secret"

# SiliconFlow
railway variables set SILICONFLOW_API_KEY="tu_siliconflow_key"
```

#### Paso 6: Deploy
```bash
railway up
```

## 🔧 Configuración de Variables de Entorno

### Variables Requeridas
```bash
# Servidor
NODE_ENV=production
PORT=$PORT

# Base de datos (auto-generadas por Railway)
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL

# Autenticación
JWT_SECRET=tu-jwt-secret-muy-largo-y-seguro

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# LemonSqueezy
LEMONSQUEEZY_API_KEY=tu-api-key
LEMONSQUEEZY_WEBHOOK_SECRET=tu-webhook-secret

# SiliconFlow
SILICONFLOW_API_KEY=tu-api-key
```

### Variables Opcionales
```bash
# CORS
CORS_ORIGIN=https://tu-frontend.com

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## 🌐 Configuración de Webhooks

Una vez desplegado, configura los webhooks:

### Stripe Webhooks
1. Ve a tu dashboard de Stripe
2. Webhooks → Add endpoint
3. URL: `https://tu-app.railway.app/api/webhooks/stripe`
4. Eventos a escuchar:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

### LemonSqueezy Webhooks
1. Ve a tu dashboard de LemonSqueezy
2. Settings → Webhooks → Add webhook
3. URL: `https://tu-app.railway.app/api/webhooks/lemonsqueezy`
4. Eventos a escuchar:
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_payment_success`

## 📊 Verificación del Deployment

### 1. Health Check
```bash
curl https://tu-app.railway.app/health
```

Respuesta esperada:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "environment": "production"
}
```

### 2. API Info
```bash
curl https://tu-app.railway.app/api
```

### 3. Test de endpoints
```bash
# Test de registro
curl -X POST https://tu-app.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'
```

## 🔍 Monitoring y Logs

### Ver logs en tiempo real
```bash
railway logs --tail
```

### Ver variables de entorno
```bash
railway variables
```

### Abrir dashboard de Railway
```bash
railway open
```

### Ver métricas
- CPU y memoria en el dashboard de Railway
- Logs de aplicación en tiempo real
- Métricas de base de datos

## 🚨 Troubleshooting

### Problemas Comunes

#### 1. Error de conexión a base de datos
```bash
# Verificar variables de entorno
railway variables | grep DATABASE

# Verificar que MySQL esté corriendo
railway status
```

#### 2. Error 503 Service Unavailable
```bash
# Ver logs para identificar el error
railway logs --tail 50

# Verificar health check
curl https://tu-app.railway.app/health
```

#### 3. Variables de entorno faltantes
```bash
# Listar todas las variables
railway variables

# Agregar variable faltante
railway variables set VARIABLE_NAME="valor"
```

#### 4. Build fallido
```bash
# Ver logs de build
railway logs --deployment

# Verificar package.json
cat package.json | grep scripts
```

## 🔄 Updates y Redeploy

### Deploy automático
Railway hace redeploy automático cuando pusheas a la rama main:
```bash
git add .
git commit -m "Update: nueva funcionalidad"
git push origin main
```

### Deploy manual
```bash
railway up
```

### Rollback
```bash
railway rollback
```

## 💰 Costos Estimados

### Railway Pricing
- **Starter Plan**: $5/mes
  - 512MB RAM
  - 1GB storage
  - Ideal para desarrollo

- **Pro Plan**: $20/mes
  - 8GB RAM
  - 100GB storage
  - Ideal para producción

### Servicios adicionales
- **MySQL**: ~$5-10/mes
- **Redis**: ~$3-5/mes

**Total estimado**: $13-35/mes dependiendo del tráfico

## 🎯 Próximos Pasos

1. ✅ Configurar dominio personalizado
2. ✅ Configurar SSL (automático en Railway)
3. ✅ Configurar monitoring avanzado
4. ✅ Configurar backups automáticos
5. ✅ Configurar CI/CD con GitHub Actions

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs: `railway logs`
2. Verifica variables: `railway variables`
3. Consulta la documentación: [docs.railway.app](https://docs.railway.app)
4. Contacta soporte de Railway

---

**¡Tu Flowmatik Backend estará en vivo en minutos!** 🚀

