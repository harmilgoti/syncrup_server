import axios from 'axios';

export class ExternalAIService {
    private apiUrl: string;

    constructor() {
        this.apiUrl = process.env.EXTERNAL_AI_API_URL || 'http://localhost:8000';
    }

    /**
     * Send repository to external AI server for graph generation
     * @param projectId - Project UUID
     * @param repoUrl - Git repository URL
     * @param repoId - Repository UUID
     * @returns Promise<boolean> - Success status
     */
    async sendRepositoryToAI(
        projectId: string,
        repoUrl: string,
        repoId: string
    ): Promise<{ success: boolean; error?: string }> {
        const maxRetries = 3;
        const endpoint = `${this.apiUrl}/add-repository`;

        // Validate inputs
        if (!this.isValidUUID(projectId)) {
            return { success: false, error: 'Invalid project ID format' };
        }

        if (!this.isValidGitUrl(repoUrl)) {
            return { success: false, error: 'Invalid Git URL format' };
        }

        console.log(`[EXTERNAL_AI] Sending repo to AI server: ${repoUrl}`);
        console.log(`[EXTERNAL_AI] Project ID: ${projectId}, Repo ID: ${repoId}`);
        console.log(`[EXTERNAL_AI] Endpoint: ${endpoint}`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.post(
                    endpoint,
                    {
                        project_id: projectId,
                        repo_url: repoUrl,
                    },
                    {
                        timeout: 30000, // 30 second timeout
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    }
                );

                if (response.status === 200 || response.status === 201) {
                    console.log(`[EXTERNAL_AI] ✅ Successfully sent repo ${repoId} to AI server`);
                    return { success: true };
                }

                console.warn(`[EXTERNAL_AI] Unexpected status code: ${response.status}`);
                return { success: false, error: `Unexpected status: ${response.status}` };

            } catch (error: any) {
                const isLastAttempt = attempt === maxRetries;
                const statusCode = error.response?.status;

                // Handle different error types
                if (statusCode && statusCode >= 400 && statusCode < 500) {
                    // Client error - don't retry
                    console.error(`[EXTERNAL_AI] ❌ Client error (${statusCode}):`, error.response?.data || error.message);
                    return {
                        success: false,
                        error: `Client error: ${error.response?.data?.message || error.message}`
                    };
                }

                if (statusCode && statusCode >= 500) {
                    // Server error - retry
                    console.warn(`[EXTERNAL_AI] Server error (${statusCode}), attempt ${attempt}/${maxRetries}`);
                } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    // Network error - retry
                    console.warn(`[EXTERNAL_AI] Network error (${error.code}), attempt ${attempt}/${maxRetries}`);
                } else {
                    // Unknown error
                    console.error(`[EXTERNAL_AI] Unknown error:`, error.message);
                }

                if (isLastAttempt) {
                    console.error(`[EXTERNAL_AI] ❌ Failed to send repo ${repoId} after ${maxRetries} attempts`);
                    return {
                        success: false,
                        error: error.response?.data?.message || error.message || 'Unknown error'
                    };
                }

                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt - 1) * 1000;
                console.log(`[EXTERNAL_AI] Retrying in ${delay}ms...`);
                await this.sleep(delay);
            }
        }

        return { success: false, error: 'Max retries exceeded' };
    }

    /**
     * Validate UUID format
     */
    private isValidUUID(uuid: string): boolean {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
    }

    /**
     * Validate Git URL format
     */
    private isValidGitUrl(url: string): boolean {
        // Accept http://, https://, git@, or file paths
        return (
            url.startsWith('http://') ||
            url.startsWith('https://') ||
            url.startsWith('git@') ||
            url.startsWith('/') ||
            /^[a-zA-Z]:\\/.test(url) // Windows path
        );
    }

    /**
     * Sleep utility for retry delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
