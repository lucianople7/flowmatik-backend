#!/bin/bash

# 🚀 Flowmatik Backend - Railway Deployment Script
# Este script automatiza el deployment en Railway

set -e

echo "🚀 Iniciando deployment de Flowmatik Backend en Railway..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logging
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    error "No se encontró package.json. Ejecuta este script desde el directorio del proyecto."
    exit 1
fi

# Verificar que Railway CLI está instalado
if ! command -v railway &> /dev/null; then
    warn "Railway CLI no está instalado. Instalando..."
    npm install -g @railway/cli
fi

# Login a Railway (si no está logueado)
log "Verificando autenticación con Railway..."
if ! railway whoami &> /dev/null; then
    log "Necesitas hacer login en Railway..."
    railway login
fi

# Verificar que el proyecto existe
log "Verificando proyecto en Railway..."
if ! railway status &> /dev/null; then
    warn "No hay proyecto de Railway vinculado. Creando nuevo proyecto..."
    railway init
fi

# Instalar dependencias
log "Instalando dependencias..."
npm ci --only=production

# Ejecutar tests
log "Ejecutando tests..."
npm test

# Build del proyecto
log "Construyendo proyecto..."
npm run build

# Verificar que el build fue exitoso
if [ ! -d "dist" ]; then
    error "El build falló. No se encontró el directorio 'dist'."
    exit 1
fi

# Configurar variables de entorno en Railway
log "Configurando variables de entorno..."

# Variables básicas
railway variables set NODE_ENV=production
railway variables set PORT=\$PORT

# JWT
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(openssl rand -base64 64)
    railway variables set JWT_SECRET="$JWT_SECRET"
    log "JWT_SECRET generado automáticamente"
else
    railway variables set JWT_SECRET="$JWT_SECRET"
fi

# Agregar servicios de base de datos
log "Configurando servicios de base de datos..."

# Verificar si MySQL ya existe
if ! railway service list | grep -q "mysql"; then
    log "Agregando servicio MySQL..."
    railway add mysql
    sleep 10 # Esperar a que se configure
fi

# Verificar si Redis ya existe
if ! railway service list | grep -q "redis"; then
    log "Agregando servicio Redis..."
    railway add redis
    sleep 10 # Esperar a que se configure
fi

# Deploy del proyecto
log "Desplegando en Railway..."
railway up --detach

# Esperar a que el deployment termine
log "Esperando a que el deployment termine..."
sleep 30

# Verificar el deployment
log "Verificando deployment..."
RAILWAY_URL=$(railway domain)

if [ -n "$RAILWAY_URL" ]; then
    log "🎉 ¡Deployment exitoso!"
    log "🌐 URL: $RAILWAY_URL"
    log "🔍 Health Check: $RAILWAY_URL/health"
    log "📚 API Info: $RAILWAY_URL/api"
    
    # Verificar health check
    log "Verificando health check..."
    if curl -f "$RAILWAY_URL/health" > /dev/null 2>&1; then
        log "✅ Health check exitoso"
    else
        warn "❌ Health check falló - el servicio puede estar iniciando"
    fi
else
    error "No se pudo obtener la URL del deployment"
    exit 1
fi

# Mostrar logs recientes
log "Mostrando logs recientes..."
railway logs --tail 20

# Información adicional
echo ""
echo "🎯 PRÓXIMOS PASOS:"
echo "1. Configura las variables de entorno faltantes:"
echo "   - STRIPE_SECRET_KEY"
echo "   - LEMONSQUEEZY_API_KEY"
echo "   - SILICONFLOW_API_KEY"
echo ""
echo "2. Configura webhooks:"
echo "   - Stripe: $RAILWAY_URL/api/webhooks/stripe"
echo "   - LemonSqueezy: $RAILWAY_URL/api/webhooks/lemonsqueezy"
echo ""
echo "3. Comandos útiles:"
echo "   - Ver logs: railway logs"
echo "   - Ver variables: railway variables"
echo "   - Abrir dashboard: railway open"
echo ""
echo "🚀 ¡Flowmatik Backend está en vivo!"

