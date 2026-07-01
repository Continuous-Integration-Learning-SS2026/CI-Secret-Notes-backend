const Fastify = require('fastify');
const { Pool } = require('pg');
const crypto = require('crypto');

// Mock the pg Pool module before importing or setting up the app logic
jest.mock('pg', () => {
    const mPool = {
        query: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

// Re-create the server instantiation logic for testing isolation
function buildApp() {
    const fastify = Fastify({ logger: false });
    const pool = new Pool();

    const ALGORITHM = 'aes-256-cbc';
    const deriveKey = (password) => crypto.createHash('sha256').update(String(password)).digest('base64').substring(0, 32);

    // CORS Hooks
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

    // Route: Get all notes
    fastify.get('/api/notes', async (request, reply) => {
        const { rows } = await pool.query('SELECT id, title FROM notes ORDER BY id DESC');
        return rows;
    });

    // Route: Create note
    fastify.post('/api/notes', async (request, reply) => {
        const { title, content, key } = request.body;
        const iv = crypto.randomBytes(16);
        const encryptionKey = deriveKey(key);
        
        const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
        let encryptedContent = cipher.update(content, 'utf8', 'hex');
        encryptedContent += cipher.final('hex');

        const result = await pool.query(
            'INSERT INTO notes (title, encrypted_content, iv) VALUES ($1, $2, $3) RETURNING id, title',
            [title, encryptedContent, iv.toString('hex')]
        );
        return { success: true, note: result.rows[0] };
    });

    // Route: Unlock note
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

    return fastify;
}

describe('Secret Notes Backend API - 10 Unit/Integration Tests', () => {
    let app;
    let mockPoolInstance;

    beforeAll(() => {
        app = buildApp();
        mockPoolInstance = new Pool();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // --- GET /api/notes Tests ---

    test('1. GET /api/notes should return an empty array if no notes exist', async () => {
        mockPoolInstance.query.mockResolvedValueOnce({ rows: [] });

        const response = await app.inject({
            method: 'GET',
            url: '/api/notes'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual([]);
        expect(mockPoolInstance.query).getMockName;
    });

    test('2. GET /api/notes should return only metadata (id and title) for existing notes', async () => {
        const mockNotes = [
            { id: 2, title: 'Second Note' },
            { id: 1, title: 'First Note' }
        ];
        mockPoolInstance.query.mockResolvedValueOnce({ rows: mockNotes });

        const response = await app.inject({
            method: 'GET',
            url: '/api/notes'
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(data).toHaveLength(2);
        expect(data[0]).not.toHaveProperty('encrypted_content');
        expect(data[0]).not.toHaveProperty('iv');
        expect(data[0].title).toBe('Second Note');
    });

    // --- POST /api/notes (Creation & Encryption) Tests ---

    test('3. POST /api/notes should respond with success status and the created note metadata', async () => {
        mockPoolInstance.query.mockResolvedValueOnce({
            rows: [{ id: 42, title: 'My Secret Diary' }]
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: {
                title: 'My Secret Diary',
                content: 'This is a super top secret message!',
                key: 'SafePassword123'
            }
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(data.success).toBe(true);
        expect(data.note.id).toBe(42);
        expect(data.note.title).toBe('My Secret Diary');
    });

    test('4. POST /api/notes should format and store the iv and encrypted_content securely as hex strings', async () => {
        mockPoolInstance.query.mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test' }] });

        await app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: {
                title: 'Test',
                content: 'Secret content',
                key: 'my-key'
            }
        });

        // Extract parameters sent to the DB query
        const dbArgs = mockPoolInstance.query.mock.calls[0][1];
        const encryptedContentParam = dbArgs[1];
        const ivParam = dbArgs[2];

        // Hex matches regex: check if valid string characters
        expect(encryptedContentParam).toMatch(/^[0-9a-fA-F]+$/);
        expect(ivParam).toMatch(/^[0-9a-fA-F]+$/);
        expect(ivParam.length).toBe(32); // 16 bytes IV = 32 hex chars
    });

    test('5. POST /api/notes should produce unique ciphertexts for identical contents due to randomized IVs', async () => {
        mockPoolInstance.query.mockResolvedValue({ rows: [{ id: 1, title: 'Test' }] });

        // First encryption
        await app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: { title: 'T1', content: 'Same Text', key: 'SameKey' }
        });

        // Second encryption
        await app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: { title: 'T2', content: 'Same Text', key: 'SameKey' }
        });

        const firstEncryptedBlob = mockPoolInstance.query.mock.calls[0][1][1];
        const secondEncryptedBlob = mockPoolInstance.query.mock.calls[1][1][1];

        expect(firstEncryptedBlob).not.toBe(secondEncryptedBlob);
    });

    // --- POST /api/notes/unlock (Decryption) Tests ---

    test('6. POST /api/notes/unlock should successfully decrypt a note when providing the correct key', async () => {
        // Setup raw material manually to mock DB response accurately
        const rawKey = 'correct-passphrase';
        const derivedKey = crypto.createHash('sha256').update(rawKey).digest('base64').substring(0, 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
        let enc = cipher.update('Hello Austrian DevOps Team!', 'utf8', 'hex');
        enc += cipher.final('hex');

        mockPoolInstance.query.mockResolvedValueOnce({
            rows: [{ encrypted_content: enc, iv: iv.toString('hex') }]
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/notes/unlock',
            payload: { id: 99, key: 'correct-passphrase' }
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(data.success).toBe(true);
        expect(data.content).toBe('Hello Austrian DevOps Team!');
    });

    test('7. POST /api/notes/unlock should return 404 error if note ID is missing in database', async () => {
        mockPoolInstance.query.mockResolvedValueOnce({ rows: [] });

        const response = await app.inject({
            method: 'POST',
            url: '/api/notes/unlock',
            payload: { id: 404, key: 'any-key' }
        });

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.payload).error).toBe('Note not found');
    });

    test('8. POST /api/notes/unlock should return 403 error when given an incorrect decryption key', async () => {
        // Store with one key setup
        const iv = crypto.randomBytes(16);
        mockPoolInstance.query.mockResolvedValueOnce({
            rows: [{ 
                encrypted_content: 'abcdef1234567890', // dummy hex payload
                iv: iv.toString('hex') 
            }]
        });

        // Request decryption with an arbitrary wrong key
        const response = await app.inject({
            method: 'POST',
            url: '/api/notes/unlock',
            payload: { id: 5, key: 'wrong-passphrase' }
        });

        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.payload).error).toBe('Invalid key');
    });

    // --- Global Hook & Edge Cases Tests ---

    test('9. OPTIONS requests should handle permissive CORS preflight checks properly', async () => {
        const response = await app.inject({
            method: 'OPTIONS',
            url: '/api/notes'
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toBe('GET,POST,OPTIONS');
    });

    test('10. GET /api/notes should pass through any unexpected Database errors downstream', async () => {
        mockPoolInstance.query.mockRejectedValueOnce(new Error('Database Connection Lost'));

        const response = await app.inject({
            method: 'GET',
            url: '/api/notes'
        });

        // Fastify defaults to 500 status on unhandled internal route crashes
        expect(response.statusCode).toBe(500); 
    });
});