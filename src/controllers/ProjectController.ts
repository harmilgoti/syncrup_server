import { Request, Response } from 'express';
import { ProjectService } from '../services/ProjectService';
import { ExternalAIService } from '../services/ExternalAIService';
import { getIO } from '../services/SocketService';

const projectService = new ProjectService();

export class ProjectController {

    static async createProject(req: Request, res: Response) {
        try {
            const { name } = req.body;
            const project = await projectService.createProject(name);
            res.json(project);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    static async getProjects(req: Request, res: Response) {
        try {
            const projects = await projectService.getProjects();
            res.json(projects);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    static async addRepo(req: Request, res: Response) {
        try {
            const { projectId, name, url, type } = req.body;

            // Determine initial status: SERVER -> PENDING (Send to AI now), OTHERS -> UNTRACKED (Send to AI later)
            const initialStatus = type === 'SERVER' ? 'PENDING' : 'UNTRACKED';

            const repo = await projectService.addRepo(projectId, name, url, type, initialStatus);

            console.log(`[CONTROLLER] Repository added: ${repo.id} - ${name} (${initialStatus})`);
            const io = getIO();
            io.emit('repository:added', { projectId, repository: repo });

            // Only trigger external AI call if it's a SERVER repo
            if (type === 'SERVER') {
                console.log(`[CONTROLLER] Sending SERVER repo to external AI server...`);

                const aiService = new ExternalAIService();

                // Send to external AI in background (non-blocking)
                aiService.sendRepositoryToAI(projectId, url, repo.id)
                    .then(async (result: { success: boolean; error?: string }) => {
                        if (result.success) {
                            console.log(`[CONTROLLER] ✅ Successfully sent repo ${repo.id} to AI server`);
                            const updatedRepo = await projectService.updateRepoStatus(repo.id, 'INDEXED');
                            io.emit('repository:updated', { projectId, repository: updatedRepo });
                        } else {
                            console.error(`[CONTROLLER] ❌ Failed to send repo ${repo.id} to AI server: ${result.error}`);
                            const failedRepo = await projectService.updateRepoStatus(repo.id, 'FAILED');
                            io.emit('repository:updated', { projectId, repository: failedRepo });
                        }
                    })
                    .catch(async (err: any) => {
                        console.error(`[CONTROLLER] ❌ Unexpected error sending repo ${repo.id}:`, err);
                        const failedRepo = await projectService.updateRepoStatus(repo.id, 'FAILED');
                        io.emit('repository:updated', { projectId, repository: failedRepo });
                    });
            } else {
                console.log(`[CONTROLLER] Skipping AI processing for ${type} repo ${repo.id} (Status: UNTRACKED). Waiting for connection.`);
            }

            res.json(repo);
        } catch (error) {
            const msg = (error as Error).message;
            if (msg.startsWith('SERVER_REQUIRED')) {
                res.status(400).json({ error: msg });
            } else {
                res.status(500).json({ error: msg });
            }
        }
    }

    static async createDependency(req: Request, res: Response) {
        try {
            const { sourceRepoId, targetRepoId } = req.body;
            const dep = await projectService.addDependency(sourceRepoId, targetRepoId);

            // Workflow: When connecting Server -> Web/Mobile, trigger external AI processing for the Target (Web/Mobile)
            // 1. Get Target Repo
            const targetRepo = await projectService.getRepo(targetRepoId);

            if (targetRepo && targetRepo.status === 'UNTRACKED') {
                console.log(`[CONTROLLER] Connection established. Sending tied repo ${targetRepo.name} to AI server...`);
                const io = getIO();

                // Update to PENDING
                const pendingRepo = await projectService.updateRepoStatus(targetRepo.id, 'PENDING');
                io.emit('repository:updated', { projectId: pendingRepo.projectId, repository: pendingRepo });

                const aiService = new ExternalAIService();

                // Send to external AI in background
                aiService.sendRepositoryToAI(pendingRepo.projectId, pendingRepo.url, pendingRepo.id)
                    .then(async (result: { success: boolean; error?: string }) => {
                        if (result.success) {
                            console.log(`[CONTROLLER] ✅ Successfully sent repo ${pendingRepo.id} to AI server`);
                            const indexedRepo = await projectService.updateRepoStatus(pendingRepo.id, 'INDEXED');
                            io.emit('repository:updated', { projectId: pendingRepo.projectId, repository: indexedRepo });
                        } else {
                            console.error(`[CONTROLLER] ❌ Failed to send repo ${pendingRepo.id} to AI server: ${result.error}`);
                            const failedRepo = await projectService.updateRepoStatus(pendingRepo.id, 'FAILED');
                            io.emit('repository:updated', { projectId: pendingRepo.projectId, repository: failedRepo });
                        }
                    })
                    .catch(async (err: any) => {
                        console.error(`[CONTROLLER] ❌ Unexpected error sending repo ${pendingRepo.id}:`, err);
                        const failedRepo = await projectService.updateRepoStatus(pendingRepo.id, 'FAILED');
                        io.emit('repository:updated', { projectId: pendingRepo.projectId, repository: failedRepo });
                    });
            }

            res.json(dep);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    static async deleteDependency(req: Request, res: Response) {
        try {
            const { sourceRepoId, targetRepoId } = req.body;
            await projectService.removeDependency(sourceRepoId, targetRepoId);

            console.log(`[CONTROLLER] Removed dependency ${sourceRepoId} -> ${targetRepoId}`);

            // Logic: Check if target repo is now orphaned (no incoming deps)
            const incomingCount = await projectService.countIncomingDependencies(targetRepoId);

            if (incomingCount === 0) {
                const targetRepo = await projectService.getRepo(targetRepoId);
                // Only revert if it's NOT a server repo (Servers stand alone)
                if (targetRepo && targetRepo.type !== 'SERVER') {
                    console.log(`[CONTROLLER] Repo ${targetRepo.name} is now orphaned. Reverting to UNTRACKED.`);

                    // Revert Status (no graph data to clear - handled by external AI)
                    const untrackedRepo = await projectService.updateRepoStatus(targetRepo.id, 'UNTRACKED');
                    const io = getIO();
                    io.emit('repository:updated', { projectId: untrackedRepo.projectId, repository: untrackedRepo });
                }
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    static async getGraph(req: Request, res: Response) {
        try {
            const { projectId } = req.query;

            if (!projectId) {
                return res.status(400).json({ error: 'projectId is required' });
            }

            // Fetch graph data from external AI server
            const aiUrl = process.env.EXTERNAL_AI_API_URL || 'http://localhost:8000';
            const endpoint = `${aiUrl}/graph-data?project_id=${projectId}`;

            console.log(`[CONTROLLER] Fetching graph data from: ${endpoint}`);

            try {
                const response = await fetch(endpoint);

                if (!response.ok) {
                    throw new Error(`External AI server returned ${response.status}`);
                }

                const data = await response.json();
                res.json(data);
            } catch (aiError) {
                console.error('[CONTROLLER] Failed to fetch from AI server:', aiError);
                // Return empty graph if AI server is unavailable
                res.json({
                    nodes: [],
                    edges: []
                });
            }
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }
}
