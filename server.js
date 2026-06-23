require('dotenv').config(); // Cargar variables de entorno desde el archivo .env

const PORT      = process.env.PORT      || 3003; // Puerto HTTPS configurado en .env o por defecto 3003
const HTTP_PORT  = process.env.HTTP_PORT  || 3002; // Puerto HTTP configurado en .env o por defecto 3002
const ADMIN_TOKEN = process.env.ADMIN_SECRET_TOKEN; // Token secreto para operaciones administrativas
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_CA_PATH = process.env.SSL_CA_PATH;
const express = require('express');
const cors = require('cors');
const fs = require('fs'); // Módulo de sistema de archivos para leer y escribir el archivo JSON
const http  = require('http');
const https = require('https');
const path = require('path'); // Módulo para manejar rutas de archivos de manera segura

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'visits.json'); // Ruta al archivo JSON que almacena el conteo de visitas

/**
 * Construye la configuración HTTPS a partir de variables de entorno.
 * Requiere SSL_KEY_PATH y SSL_CERT_PATH; SSL_CA_PATH es opcional.
 *
 * @returns {import('https').ServerOptions} Opciones TLS para https.createServer.
 * @throws {Error} Cuando faltan rutas SSL obligatorias.
 */
function buildHttpsOptions() {
    if (!SSL_KEY_PATH || !SSL_CERT_PATH) {
        throw new Error('Faltan SSL_KEY_PATH o SSL_CERT_PATH en las variables de entorno');
    }

    const httpsOptions = {
        key: fs.readFileSync(path.resolve(SSL_KEY_PATH)),
        cert: fs.readFileSync(path.resolve(SSL_CERT_PATH))
    };

    if (SSL_CA_PATH) {
        httpsOptions.ca = fs.readFileSync(path.resolve(SSL_CA_PATH));
    }

    return httpsOptions;
}

// Middleware
app.use(cors()); // Permitir solicitudes desde cualquier origen
app.use(express.json()); // Parsear el cuerpo de las solicitudes como JSON

/**
 * Registra metadatos seguros de la petición evitando estructuras circulares.
 * Incluye el protocolo (http/https) para identificar el origen de la llamada.
 *
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 */
function logRequest(req) {
    console.log(`[${req.protocol.toUpperCase()}] [${req.method}] ${req.originalUrl} - ip: ${req.ip}`);
}

// Variables para el control de concurrencias
let isWriting = false; // Indica si se está escribiendo en el archivo
const writeQueue = []; // Cola de funciones de escritura pendientes

// Función para escribir en el archivo
async function safeWriteToFile(data) {
    return new Promise((resolve, reject) => {
        const executeWrite = async () => {
            if (isWriting) {
                // Si ya se está escribiendo, agregar a la cola
                writeQueue.push({resolve, reject});
                return;
            }
            isWriting = true; // Marcar que se está escribiendo
            try {
                // Crear backup antes de escribir
                try {
                    await fs.promises.copyFile(DATA_FILE, `${DATA_FILE}.backup`); // Crear una copia de seguridad antes de escribir
                } catch (err){
                    console.error('Error creando la copia de seguridad:', err);
                }

                // Escribir en archivo temporal primero
                const tempFile = `${DATA_FILE}.tmp`;
                await fs.promises.writeFile(tempFile, JSON.stringify(data, null, 2));

                // Renombrar (operación atómica)
                await fs.promises.rename(tempFile, DATA_FILE);
                console.log(`Archivo de visitas actualizado: ${data.count} visitas`);
                resolve(data); // Resolver la promesa con los datos escritos
            } catch (err) {
                    reject(err); // Rechazar la promesa en caso de error
            } finally {
                isWriting = false; // Marcar que se ha terminado de escribir
                // Procesar la siguiente escritura en la cola, si existe
                if (writeQueue.length > 0) {
                    const nextWrite = writeQueue.shift();
                    executeWrite().then(nextWrite.resolve).catch(nextWrite.reject); // Ejecutar la siguiente escritura
                }
            }
        };
        executeWrite();
    });
}

// Inicializar archivo de visitas si no existe
async function initializeDataFile(){
    try {
        await fs.promises.access(DATA_FILE); // Verificar si el archivo existe
        console.log('Archivo de visitas encontrado en', DATA_FILE);
    } catch (err) {
        // Si el archivo no existe, crear uno nuevo con conteo inicial de 0
        const initialData = { count: 0 };
        await safeWriteToFile(initialData);
        console.log('Archivo de visitas creado con conteo inicial de 0 en', DATA_FILE);
    }
}

// Endpoint para obtener el contador actual
app.get('/api/visits', async (req, res) => {
    try {
        // console.log("/api/visits accedido");
        const data = await fs.promises.readFile(DATA_FILE, 'utf-8'); // Leer el archivo de visitas
        const visits = JSON.parse(data); // Parsear el contenido del archivo como JSON
        logRequest(req);
        res.json({
            success: true,
            count: visits.count
        }); // Enviar el conteo de visitas como respuesta JSON
    } catch (err) {
        console.error('Error leyendo el archivo de visitas:', err);
        res.status(500).json({ success: false, error: 'Error leyendo el archivo de visitas' });
    }
});

// Endpoint para incrementar el contador de visitas
app.post('/api/visits/increment', async (req, res) => {
    try {
        // console.log("/api/visits/increment accedido");
        logRequest(req);
        // Leer valor actual
        const data = await fs.promises.readFile(DATA_FILE, 'utf-8');
        const currentVisits = JSON.parse(data);

        // Incrementar el contador
        currentVisits.count += 1;

        // Escribir el nuevo valor de forma segura
        await safeWriteToFile(currentVisits);

        res.json({
            success: true,
            count: currentVisits.count
        });
    } catch (err) {
        console.error('Error incrementando el contador de visitas:', err);
        res.status(500).json({ success: false, error: 'Error incrementando el contador de visitas' });
    }
});

// Endpoint para reiniciar contador (solo admin - opcional)
app.post('/api/visits/reset', async (req, res) => {
    logRequest(req);
    // Verificar token secreto (seguridad básica)
    const secretToken = req.headers['admin-token'];

    if (secretToken !== ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: 'No autorizado' });
    }

    try {
        const resetData = { count: 0 };
        await safeWriteToFile(resetData);
        console.log('Contador de visitas reiniciado a 0');
        res.json({ success: true, count: 0, message: 'Contador de visitas reiniciado correctamente' });
    } catch (err) {
        console.error('Error reiniciando el contador de visitas:', err);
        res.status(500).json({ success: false, error: 'Error reiniciando el contador de visitas' });
    }   
});

// Ruta de prueba
app.get('/api/health', (req, res) => {
    console.log('Ruta /api/health accedida');
    res.json({
        success: true,
        message: 'API está saludable', 
        timestamp: new Date().toISOString()
    });
});

/**
 * Inicia el servidor HTTP en el puerto HTTP_PORT.
 * Comparte la misma aplicación Express que el servidor HTTPS,
 * por lo que responde a los mismos endpoints.
 *
 * @param {number|string} port - Puerto en el que escucha el servidor HTTP.
 * @returns {import('http').Server} Instancia del servidor HTTP.
 */
function startHttpServer(port) {
    return http.createServer(app).listen(port, () => {
        console.log(`Servidor HTTP  ejecutándose en el puerto ${port}`);
    });
}

/**
 * Inicia el servidor HTTPS en el puerto PORT.
 * Si las variables SSL no están configuradas, lanza un error.
 * Comparte la misma aplicación Express que el servidor HTTP.
 *
 * @param {number|string} port - Puerto en el que escucha el servidor HTTPS.
 * @returns {import('https').Server} Instancia del servidor HTTPS.
 */
function startHttpsServer(port) {
    const httpsOptions = buildHttpsOptions();
    return https.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Servidor HTTPS ejecutándose en el puerto ${port}`);
    });
}

/**
 * Punto de entrada: inicializa el archivo de datos y levanta
 * ambos servidores (HTTP y HTTPS) de forma concurrente.
 * Los endpoints son idénticos independientemente del protocolo usado.
 *
 * @returns {Promise<void>}
 */
async function startServer() {
    await initializeDataFile();

    startHttpServer(HTTP_PORT);
    // startHttpsServer(PORT);

    console.log(`📊 Endpoints disponibles (HTTP puerto ${HTTP_PORT} / HTTPS puerto ${PORT}):`);
    console.log(`   - GET  /api/visits           (obtener contador)`);
    console.log(`   - POST /api/visits/increment  (incrementar)`);
    console.log(`   - POST /api/visits/reset      (reiniciar contador - solo admin)`);
    console.log(`   - GET  /api/health            (verificar estado de la API)`);
}

startServer();