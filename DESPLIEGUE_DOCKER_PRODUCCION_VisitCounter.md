# Despliegue en Producción con Docker

Este documento describe, paso a paso, la configuración necesaria para desplegar el backend del contador de visitas dentro de un contenedor Docker en producción.

La aplicación expone la misma API por HTTP y HTTPS al mismo tiempo. Según el código actual:

- HTTP escucha en `HTTP_PORT`.
- HTTPS escucha en `PORT`.
- Los certificados TLS se cargan desde las rutas definidas en `SSL_KEY_PATH`, `SSL_CERT_PATH` y, de forma opcional, `SSL_CA_PATH`.
- El contador se guarda en `data/visits.json` y se crea automáticamente si no existe.

## 1. Requisitos previos

Antes de continuar, verifica lo siguiente:

- Docker instalado en el servidor de producción.
- Acceso al código fuente o a una imagen Docker ya construida.
- Certificado TLS válido para el dominio o IP del servicio.
- Puertos libres para publicar el contenedor.
- Permisos de lectura para la carpeta de certificados y de escritura para la carpeta de datos.

## 2. Estructura mínima que debe mantenerse

Dentro del entorno de despliegue debe conservarse esta estructura base:

- `server.js`
- `package.json`
- `.env`
- `certs/`
- `data/`

En Docker, la práctica recomendada es montar estas carpetas como volúmenes para persistir los datos y mantener separados los certificados.

## 3. Preparar el archivo `.env`

Crea o ajusta el archivo `.env` con las variables que usa el backend.

Ejemplo:

```env
PORT=3003
HTTP_PORT=3002
ADMIN_SECRET_TOKEN=un-token-seguro
SSL_KEY_PATH=./certs/server-key.pem
SSL_CERT_PATH=./certs/server-cert.pem
SSL_CA_PATH=
```

### Qué hace cada variable

- `PORT`: puerto HTTPS del backend dentro del contenedor.
- `HTTP_PORT`: puerto HTTP del backend dentro del contenedor.
- `ADMIN_SECRET_TOKEN`: token necesario para el endpoint de reinicio.
- `SSL_KEY_PATH`: ruta dentro del contenedor hacia la llave privada.
- `SSL_CERT_PATH`: ruta dentro del contenedor hacia el certificado público.
- `SSL_CA_PATH`: ruta opcional hacia la cadena intermedia o CA.

Importante: las rutas SSL se resuelven dentro del contenedor. Si montas los certificados en `/app/certs`, entonces el `.env` debe apuntar a rutas como `./certs/server-key.pem` o equivalentes dentro de `/app`.

## 4. Ubicar los certificados TLS

Coloca los archivos del certificado en la carpeta `certs/` del proyecto o móntalos desde una ruta externa al contenedor.

Ejemplo esperado:

- `certs/server-key.pem`
- `certs/server-cert.pem`
- `certs/server-ca.pem` si aplica

Si el certificado pertenece a un dominio real, usa el nombre de archivo que corresponda y actualiza el `.env`.

## 5. Preparar la persistencia de datos

El backend almacena el contador en `data/visits.json`.

Para evitar perder el conteo al reiniciar el contenedor:

1. Crea la carpeta `data/` si no existe.
2. Monta esa carpeta como volumen persistente.
3. Asegura permisos de escritura sobre esa ruta.

Si `visits.json` no existe al arrancar, la aplicación lo crea con `count: 0`.

## 6. Crear la imagen Docker

Si todavía no tienes una imagen, puedes construir una con un `Dockerfile` similar al siguiente:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3002 3003

CMD ["node", "server.js"]
```

### Recomendaciones para la imagen

- Usa una versión estable de Node.js compatible con el proyecto.
- Evita incluir secretos dentro de la imagen.
- Mantén los certificados y los datos fuera de la capa de construcción.
- Expón ambos puertos porque el servicio publica HTTP y HTTPS.

## 7. Construir la imagen

Desde la carpeta `visit-counter-backend`, ejecuta:

```bash
docker build -t visit-counter-backend:latest .
```

Si el `Dockerfile` se ubica en otra ruta, ajusta el contexto y el archivo de build según corresponda.

## 8. Ejecutar el contenedor

La forma más simple de levantar el backend en producción es con `docker run` y volúmenes montados.

```bash
docker run -d \
  --name visit-counter-backend \
  --restart unless-stopped \
  -p 3002:3002 \
  -p 3003:3003 \
  --env-file .env \
  -v "%cd%/data:/app/data" \
  -v "%cd%/certs:/app/certs:ro" \
  visit-counter-backend:latest
```

Si el servidor es Linux, sustituye `"%cd%"` por la ruta real del proyecto o usa una ruta absoluta como `/opt/visit-counter-backend`.

### Qué debe pasar con los volúmenes

- `data/` debe montarse con permisos de escritura.
- `certs/` debe montarse en modo lectura solamente.
- El archivo `.env` puede inyectarse con `--env-file` o variables de entorno directas.

## 9. Alternativa recomendada con Docker Compose

En producción suele ser más cómodo administrar el servicio con `docker-compose.yml`.

Ejemplo:

```yaml
services:
  visit-counter-backend:
    image: visit-counter-backend:latest
    container_name: visit-counter-backend
    restart: unless-stopped
    ports:
      - "3002:3002"
      - "3003:3003"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./certs:/app/certs:ro
```

Arranque:

```bash
docker compose up -d
```

## 10. Flujo paso a paso de despliegue

1. Copia el código del backend al servidor o descarga la imagen publicada.
2. Verifica que existan las carpetas `certs/` y `data/`.
3. Coloca los certificados TLS en `certs/`.
4. Crea el archivo `.env` con los puertos, el token y las rutas de certificados.
5. Confirma que `PORT`, `HTTP_PORT`, `SSL_KEY_PATH` y `SSL_CERT_PATH` coincidan con la estructura montada dentro del contenedor.
6. Construye la imagen con `docker build` o descarga la imagen desde un registry.
7. Inicia el contenedor con `docker run` o `docker compose up -d`.
8. Revisa los logs del contenedor para confirmar que los servidores HTTP y HTTPS iniciaron sin errores.
9. Valida los endpoints de salud y visitas.

## 11. Verificación después del arranque

Prueba los endpoints expuestos por el servicio:

- `GET /api/health`
- `GET /api/visits`
- `POST /api/visits/increment`
- `POST /api/visits/reset`

Ejemplos:

- `http://localhost:3002/api/health`
- `https://localhost:3003/api/health`

Si el certificado es autofirmado, el navegador puede mostrar advertencias de seguridad.

## 12. Reinicio del contador

Para reiniciar el contador, el endpoint `POST /api/visits/reset` requiere el encabezado:

- `admin-token: valor-de-ADMIN_SECRET_TOKEN`

Ejemplo:

```bash
curl -X POST https://localhost:3003/api/visits/reset \
  -H "admin-token: un-token-seguro" \
  -k
```

## 13. Recomendaciones de producción

- No incluyas los certificados dentro de la imagen si puedes montarlos como volumen.
- Protege `ADMIN_SECRET_TOKEN` y no lo publiques en el repositorio.
- Mantén el volumen `data/` persistente para no perder el conteo.
- Usa un certificado emitido por una autoridad confiable si el servicio estará expuesto públicamente.
- Abre únicamente los puertos necesarios en el firewall.
- Revisa los logs del contenedor después de cada actualización.

## 14. Problemas frecuentes

- Error al iniciar HTTPS: confirma que `SSL_KEY_PATH` y `SSL_CERT_PATH` apunten a archivos existentes dentro del contenedor.
- Error de puerto ocupado: cambia `PORT` o `HTTP_PORT` y vuelve a levantar el contenedor.
- Error de permisos en datos: revisa que el volumen `data/` tenga permisos de escritura.
- El contador vuelve a cero: verifica que `data/` esté montado como volumen persistente y no como carpeta temporal.
- El endpoint de reinicio responde `401`: revisa el valor del encabezado `admin-token`.

## 15. Resumen rápido

1. Prepara `certs/`, `data/` y `.env`.
2. Construye la imagen con Docker.
3. Publica los puertos `3002` y `3003`.
4. Monta `data/` y `certs/` como volúmenes.
5. Ejecuta el contenedor.
6. Verifica `/api/health` y `/api/visits`.