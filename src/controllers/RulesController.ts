import { Request, Response } from 'express';
import { ProjectService } from '../services/ProjectService';
import { IndexerService } from '../services/IndexerService';
import { GraphService } from '../services/GraphService';
import { getIO } from '../services/SocketService';
import { analyzeCodeWithAI } from '../utils/rulesAi';

const projectService = new ProjectService();
interface AnalyzeRequest {
    code: string;
    fileType: 'react' | 'node' | 'typescript';
    rules: any; // Support both old and new format
    filePath?: string;
}

export class RulesController {

    static async analyze(req: Request, res: Response) {
            try {
        const { code, fileType, rules, filePath } = req.body as AnalyzeRequest;

        // Validation
        if (!code || !fileType || !rules) {
            return res.status(400).json({
                error: 'Missing required fields: code, fileType, or rules',
            });
        }
        
        console.log(`Analyzing ${fileType} code${filePath ? ` (${filePath})` : ''} with rules`);


        // Step 2: Run AI-based semantic analysis
        const aiViolations = await analyzeCodeWithAI(code, fileType, rules, filePath);
        // console.log("aiViolations",staticViolations,aiViolations);
        
        // Combine violations (remove duplicates based on line and rule)
        const allViolations = [ ...aiViolations];
        const uniqueViolations = Array.from(
            new Map(
                allViolations.map((v) => [`${v.rule}-${v.line}`, v])
            ).values()
        );

        console.log(`Found ${uniqueViolations.length} total violations`);

        res.json({
            violations: uniqueViolations,
            summary: {
                total: uniqueViolations.length,
                // static: staticViolations.length,
                ai: aiViolations.length,
            },
        });
    } catch (error: any) {
        console.error('Analysis error:', error);
        res.status(500).json({
            error: error.message || 'Failed to analyze code',
        });
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
}