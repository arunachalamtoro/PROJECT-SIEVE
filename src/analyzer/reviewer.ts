/**
 * Reviewer — calls the Anthropic Claude API with the assembled context.
 * Returns structured review with token usage and cost accounting.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ReviewResult, TokenUsage, SifthookConfig } from '../types.js';
import { calculateCost } from '../types.js';

/**
 * Send the review prompt to Claude/OpenRouter and get a structured review back.
 */
export async function reviewWithClaude(
  prompt: string,
  config: SifthookConfig
): Promise<ReviewResult> {
  const apiKey = process.env[config.api_key_env_var];
  if (!apiKey) {
    throw new Error(
      `${config.api_key_env_var} environment variable is not set.\n` +
      `Set it with: export ${config.api_key_env_var}=your-key-here`
    );
  }

  let responseText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  if (config.provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => {
        if (block.type === 'text') return block.text;
        return '';
      })
      .join('');
  } else {
    // OpenRouter or Custom (OpenAI-compatible format)
    const baseUrl = config.api_base_url || 'https://openrouter.ai/api/v1/chat/completions';
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/sifthook',
        'X-Title': 'Sifthook',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API returned ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    responseText = data.choices[0]?.message?.content || '';
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;
  }

  const cost = calculateCost(config.model, inputTokens, outputTokens);

  const tokensUsed: TokenUsage = {
    input: inputTokens,
    output: outputTokens,
    estimated_cost_usd: cost,
  };


  // Try to extract JSON from the response (may be wrapped in ```json blocks)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON. Response:\n' + responseText);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error('Failed to parse Claude\'s JSON response:\n' + jsonMatch[0]);
  }

  // Validate and normalize the response
  const result: ReviewResult = {
    summary: parsed.summary ?? 'No summary provided.',
    risk_level: validateRiskLevel(parsed.risk_level),
    breaking_changes: Array.isArray(parsed.breaking_changes) ? parsed.breaking_changes : [],
    blast_radius: Array.isArray(parsed.blast_radius)
      ? parsed.blast_radius.map((br: any) => ({
          file: br.file ?? 'unknown',
          reason: br.reason ?? 'unspecified',
        }))
      : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    tokens_used: tokensUsed,
  };

  return result;
}

function validateRiskLevel(level: any): 'low' | 'medium' | 'high' {
  if (level === 'low' || level === 'medium' || level === 'high') return level;
  return 'medium';
}

/**
 * Format a review result for terminal display.
 */
export function formatReviewReport(review: ReviewResult): string {
  const lines: string[] = [];

  // Risk badge
  const riskColors: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
  };
  const riskIcon = riskColors[review.risk_level] ?? '⚪';

  lines.push('');
  lines.push('╔' + '═'.repeat(58) + '╗');
  lines.push('║' + '  🔬 SIFTHOOK CODE REVIEW'.padEnd(58) + '║');
  lines.push('╚' + '═'.repeat(58) + '╝');

  // Summary
  lines.push('');
  lines.push(`${riskIcon} Risk Level: ${review.risk_level.toUpperCase()}`);
  lines.push('');
  lines.push('📝 Summary');
  lines.push('─'.repeat(40));
  lines.push(review.summary);

  // Breaking changes
  if (review.breaking_changes.length > 0) {
    lines.push('');
    lines.push('🔴 Breaking Changes');
    lines.push('─'.repeat(40));
    for (const bc of review.breaking_changes) {
      lines.push(`  ⚠️  ${bc}`);
    }
  }

  // Blast radius
  if (review.blast_radius.length > 0) {
    lines.push('');
    lines.push('💥 Blast Radius');
    lines.push('─'.repeat(40));
    for (const br of review.blast_radius) {
      lines.push(`  📄 ${br.file}`);
      lines.push(`     ${br.reason}`);
    }
  }

  // Suggestions
  if (review.suggestions.length > 0) {
    lines.push('');
    lines.push('💡 Suggestions');
    lines.push('─'.repeat(40));
    for (const s of review.suggestions) {
      lines.push(`  → ${s}`);
    }
  }

  // Token usage
  lines.push('');
  lines.push('💰 Token Usage');
  lines.push('─'.repeat(40));
  lines.push(`  Input:  ${review.tokens_used.input.toLocaleString()} tokens`);
  lines.push(`  Output: ${review.tokens_used.output.toLocaleString()} tokens`);
  lines.push(`  Cost:   $${review.tokens_used.estimated_cost_usd.toFixed(4)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format review as a GitHub PR comment (Markdown).
 */
export function formatReviewAsMarkdown(review: ReviewResult): string {
  const riskBadges: Record<string, string> = {
    low: '![Risk: Low](https://img.shields.io/badge/Risk-Low-green)',
    medium: '![Risk: Medium](https://img.shields.io/badge/Risk-Medium-yellow)',
    high: '![Risk: High](https://img.shields.io/badge/Risk-High-red)',
  };

  const lines: string[] = [];

  lines.push('## 🔬 Sifthook Code Review');
  lines.push('');
  lines.push(riskBadges[review.risk_level] ?? '');
  lines.push('');
  lines.push('### Summary');
  lines.push(review.summary);

  if (review.breaking_changes.length > 0) {
    lines.push('');
    lines.push('### ⚠️ Breaking Changes');
    for (const bc of review.breaking_changes) {
      lines.push(`- ${bc}`);
    }
  }

  if (review.blast_radius.length > 0) {
    lines.push('');
    lines.push('### 💥 Blast Radius');
    lines.push('');
    lines.push('| File | Reason |');
    lines.push('|---|---|');
    for (const br of review.blast_radius) {
      lines.push(`| \`${br.file}\` | ${br.reason} |`);
    }
  }

  if (review.suggestions.length > 0) {
    lines.push('');
    lines.push('### 💡 Suggestions');
    for (const s of review.suggestions) {
      lines.push(`- ${s}`);
    }
  }

  lines.push('');
  lines.push('<details>');
  lines.push('<summary>💰 Token Usage</summary>');
  lines.push('');
  lines.push(`- Input tokens: ${review.tokens_used.input.toLocaleString()}`);
  lines.push(`- Output tokens: ${review.tokens_used.output.toLocaleString()}`);
  lines.push(`- Estimated cost: $${review.tokens_used.estimated_cost_usd.toFixed(4)}`);
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('*Generated by [Sifthook](https://github.com/sifthook) — AI-powered PR analysis with semantic dependency awareness*');

  return lines.join('\n');
}
