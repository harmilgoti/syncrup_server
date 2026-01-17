import dotenv from 'dotenv';
import path from 'path';

// Load .env file from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),
    database: {
        url: process.env.DATABASE_URL || '',
    },
    externalAI: {
        apiUrl: process.env.EXTERNAL_AI_API_URL || 'http://localhost:8000',
    },
};
