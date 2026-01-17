import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
    database: {
        url: process.env.DATABASE_URL || '',
    },
    server: {
        port: parseInt(process.env.PORT || '3001', 10),
    },
    ai: {
        geminiApiKey: process.env.GEMINI_API_KEY || '',
    },
};
