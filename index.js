require('dotenv').config();
const Fastify = require('fastify');
const { Pool } = require('pg');
const crypto = require('crypto');

const fastify = Fastify({ logger: true });

// Setup PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Helper for Encryption
const ALGORITHM = 'aes-256-cbc';
// We derive a stable 32-byte key from the user's password using a SHA-256 hash
const deriveKey = (password) => crypto.createHash('sha256').update(String(password)).digest('base64').substring(0, 32);

// Enable permissive CORS so the frontend can easily communicate without extra dependencies
fastify.addHook('onRequest', (request, reply, done) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
        reply.send();
    } else {
        done();
    }
});

// Route: Get all notes (only metadata, content remains encrypted in DB)
fastify.get('/api/notes', async (request, reply) => {
    const { rows } = await pool.query('SELECT id, title FROM notes ORDER BY id DESC');
    return rows;
});

// Route: Create and encrypt a new note
fastify.post('/api/notes', async (request, reply) => {
    const { title, content, key } = request.body;
    
    // Generate an Initialization Vector (IV) for AES
    const iv = crypto.randomBytes(16);
    const encryptionKey = deriveKey(key);
    
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
    let encryptedContent = cipher.update(content, 'utf8', 'hex');
    encryptedContent += cipher.final('hex');

    // Store the encrypted content and IV securely
    const result = await pool.query(
        'INSERT INTO notes (title, encrypted_content, iv) VALUES ($1, $2, $3) RETURNING id, title',
        [title, encryptedContent, iv.toString('hex')]
    );
    
    return { success: true, note: result.rows[0] };
});

// Route: Decrypt note content
fastify.post('/api/notes/unlock', async (request, reply) => {
    const { id, key } = request.body;
    
    const { rows } = await pool.query('SELECT encrypted_content, iv FROM notes WHERE id = $1', [id]);
    
    if (rows.length === 0) {
        return reply.code(404).send({ error: 'Note not found' });
    }

    try {
        const encryptionKey = deriveKey(key);
        const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, Buffer.from(rows[0].iv, 'hex'));
        
        let decrypted = decipher.update(rows[0].encrypted_content, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return { success: true, content: decrypted };
    } catch (err) {
        return reply.code(403).send({ error: 'Invalid key' });
    }
});

// Start the server and initialize the DB table
const start = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notes (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                encrypted_content TEXT NOT NULL,
                iv TEXT NOT NULL
            );
        `);
        
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log(`Server listening on port 3000`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();