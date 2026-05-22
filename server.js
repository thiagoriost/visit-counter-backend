require('dotenv').config(); // Cargar variables de entorno desde el archivo .env

const PORT = process.env.PORT || 3001; // Puerto configurado en .env o por defecto 3001
const ADMIN_TOKEN = process.env.ADMIN_SECRET_TOKEN; // Token secreto para operaciones administrativas
const express = require('express');
const cors = require('cors');
const fs = require('fs'); // File system module to read/write visit count
const path = require('path'); // Path module to handle file paths

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'visits.json'); // Path to the JSON file that stores visit count

// Middleware
app.use(cors()); // Permitir solicitudes desde cualquier origen
app.use(express.json()); // Parsear el cuerpo de las solicitudes como JSON

// Variables para el control de concurrencias
let isWriting = false; // Indica si se está escribiendo en el archivo
const writeQueue = []; // Cola de funciones de escritura pendientes

// Función segura para escribir en el archivo
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
                    await fs.copyFile(DATA_FILE, `${DATA_FILE}.backup`); // Crear una copia de seguridad antes de escribir
                } catch (err){
                    console.error('Error creating backup:', err);
                }

                // Escribir en archivo temporal primero
                const tempFile = `${DATA_FILE}.tmp`;
                await fs.writeFile(tempFile, JSON.stringify(data, null, 2));

                // Renombrar (operación atómica)
                await fs.rename(tempFile, DATA_FILE);

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
        await fs.access(DATA_FILE); // Verificar si el archivo existe
        console.log('Archivo de visitas encontrado en', DATA_FILE);
    } catch (err) {
        // Si el archivo no existe, crear uno nuevo con conteo inicial de 0
        const initialData = { count: 0 };
        await safeWriteToFile(initialData);
        console.log('Archivo de visitas creado en 0', DATA_FILE);
    }
}

// Endpoint para obtener el contador actual
app.get('/api/visits', async (req, res) => {
    try {
        const data = await fs.promises.readFile(DATA_FILE, 'utf-8'); // Leer el archivo de visitas
        const visits = JSON.parse(data); // Parsear el contenido del archivo como JSON
        res.json({
            success: true,
            count: visits.count
        }); // Enviar el conteo de visitas como respuesta JSON
    } catch (err) {
        console.error('Error reading visits file:', err);
        res.status(500).json({ success: false, error: 'Error reading visits file' });
    }
});

// Endpoint para incrementar el contador de visitas
app.post('/api/visits/increment', async (req, res) => {
    try {
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
        console.error('Error incrementing visits:', err);
        res.status(500).json({ success: false, error: 'Error incrementing visits' });
    }
});

// Endpoint para reiniciar contador (solo admin - opcional)
app.post('/api/visits/reset', async (req, res) => {

    // Verificar token secreto (seguridad básica)
    const secretToken = req.headers['admin-token'];

    if (secretToken !== ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        const resetData = { count: 0 };
        await safeWriteToFile(resetData);
        res.json({ success: true, count: 0, message: 'Visit count reset successfully' });
    } catch (err) {
        console.error('Error resetting visits:', err);
        res.status(500).json({ success: false, error: 'Error resetting visits' });
    }   
});

// Iniciar servidor
async function startServer() {
    await initializeDataFile();

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`📊 Endpoints disponibles:`);
        console.log(`   - GET  /api/visits        (obtener contador)`);
        console.log(`   - POST /api/visits/increment (incrementar)`);
        console.log(`   - POST /api/visits/reset (reiniciar contador - solo admin)`);
        console.log(`   - GET  /api/health       (health check)`);
    });
}

startServer();