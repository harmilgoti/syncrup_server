import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.warn('⚠️  GEMINI_API_KEY not found in environment variables');
    console.warn('⚠️  AI analysis will be disabled. Set GEMINI_API_KEY in .env file');
    console.warn('⚠️  Get your free API key from: https://aistudio.google.com/app/apikey');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

interface Rule {
    id: string;
    name: string;
    description: string;
    severity?: 'error' | 'warning' | 'info';
    enabled?: boolean;
    filePattern?: string;
}

interface Violation {
    rule: string;
    line: number;
    message: string;
    severity?: 'error' | 'warning' | 'info';
}

export async function analyzeCodeWithAI(
    code: string,
    fileType: string,
    rules: Rule[] | Record<string, any>,
    filePath?: string
): Promise<Violation[]> {
    if (!genAI || !apiKey) {
        console.log('Skipping AI analysis (no API key)');
        return [];
    }

    // Convert old format to new format if needed
    const normalizedRules = normalizeRules(rules);
    
    // Filter rules based on file pattern
    const applicableRules = filterRulesByFilePath(normalizedRules, filePath || '');

    try {
        const prompt = buildPrompt(code, fileType, applicableRules, filePath);

        // Use gemini-2.5-flash for free tier (2026 model)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent([
            { text: SYSTEM_PROMPT },
            { text: prompt }
        ]);

        const response = await result.response;
        const responseText = response.text();
        
        // Parse AI response
        const parsed = parseAIResponse(responseText);
        
        console.log(`AI found ${parsed.violations.length} violations`);
        return parsed.violations;
    } catch (error: any) {
        console.error('Google Gemini AI error:', error.message);
        // Don't fail the entire request if AI fails
        return [];
    }
}

function normalizeRules(rules: Rule[] | Record<string, any>): Rule[] {
    // Handle { rules: [...] } format (common from JSON files)
    if (rules && typeof rules === 'object' && Array.isArray((rules as any).rules)) {
        return ((rules as any).rules).filter((r: any) => r.enabled !== false);
    }

    // Handle direct array format
    if (Array.isArray(rules)) {
        return rules.filter(r => r.enabled !== false);
    }

    // If old format is provided, reject it with helpful error
    console.warn('⚠️  Old rule format detected. Please use the new array format with descriptions.');
    console.warn('⚠️  Example: [{ "id": "my-rule", "name": "My Rule", "description": "...", "enabled": true }]');
    
    return [];
}

function filterRulesByFilePath(rules: Rule[], filePath: string): Rule[] {
    return rules.filter(rule => {
        if (!rule.filePattern) return true;
        
        // Simple glob pattern matching (basic implementation)
        const pattern = rule.filePattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\./g, '\\.');
        
        const regex = new RegExp(pattern);
        return regex.test(filePath);
    });
}

function buildPrompt(
    code: string,
    fileType: string,
    rules: Rule[],
    filePath?: string
): string {
    const rulesDescription = rules
        .map(rule => `- [${rule.id}] ${rule.name}: ${rule.description}`)
        .join('\n');

    const filePathContext = filePath ? `\nFILE PATH: ${filePath}\n` : '';

    return `
Analyze this ${fileType} code for rule violations.
${filePathContext}
RULES TO CHECK:
${rulesDescription}

CODE:
\`\`\`${fileType}
${code}
\`\`\`

IMPORTANT:
- Only detect violations, DO NOT suggest fixes
- DO NOT rewrite or refactor code
- Explain WHY each rule is violated
- Consider the file path when checking folder structure rules
- Return ONLY the JSON response, no additional text

Return violations in this exact JSON format:
{
  "violations": [
    {
      "rule": "rule_id",
      "line": line_number,
      "message": "Brief explanation of why this violates the rule"
    }
  ]
}
`.trim();
}

function parseAIResponse(responseText: string): { violations: Violation[] } {
    try {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : responseText;

        const parsed = JSON.parse(jsonText);
        
        // Validate structure
        if (!parsed.violations || !Array.isArray(parsed.violations)) {
            return { violations: [] };
        }

        // Ensure each violation has required fields
        const violations = parsed.violations
            .filter((v: any) => v.rule && v.line && v.message)
            .map((v: any) => ({
                rule: v.rule,
                line: Number(v.line),
                message: v.message,
                severity: v.severity || 'warning',
            }));

        return { violations };
    } catch (error) {
        console.error('Failed to parse AI response:', error);
        console.error('Response text:', responseText);
        return { violations: [] };
    }
}

const SYSTEM_PROMPT = `You are an AI code reviewer that detects rule violations based on natural language rule descriptions.

YOUR ROLE:
- Interpret user-defined rules written in natural language
- Detect violations of ANY type of rule (coding patterns, folder structure, file locations, naming conventions, etc.)
- Understand context from file paths and code structure
- Explain WHY a rule is violated with specific details
- Be precise and concise

RULE INTERPRETATION:
- Rules can be about ANYTHING: code patterns, file locations, folder structure, naming, architecture, etc.
- Use the rule's description to understand what to check
- Consider the file path when checking folder/location rules
- Apply common sense and context awareness

YOU MUST NOT:
- Generate new code
- Refactor existing code
- Suggest fixes or solutions
- Rewrite any code
- Make assumptions beyond what the rule description states

You are ONLY an intelligent reviewer that identifies problems based on the provided rule descriptions.

Always respond with valid JSON in the exact format specified by the user.`;
