import { type RuleObject, sanitizeRules } from './rule-schema';

export class RuleValidationError extends Error {}

const FORBIDDEN_META_KEYS = ['extends', 'rewrite', 'duplicatePolicy'];

export function assertNoAdvancedMeta(rulesJson: Record<string, unknown>): void {
  const meta = rulesJson?.meta as Record<string, unknown> | undefined;
  if (!meta) {
    return;
  }
  for (const key of FORBIDDEN_META_KEYS) {
    if (meta[key] !== undefined) {
      throw new RuleValidationError(
        `meta.${key} is not allowed in managed core/template`,
      );
    }
  }
}

export function ensureRulesArray(
  rulesJson: Record<string, unknown>,
): Record<string, unknown>[] {
  const rules = rulesJson?.rules;
  if (!Array.isArray(rules)) {
    throw new RuleValidationError('rules must be an array');
  }
  return rules as Record<string, unknown>[];
}

export function applyCoreTag(rules: RuleObject[], tag: string): RuleObject[] {
  return rules.map((rule) => {
    const tags = Array.isArray(rule.tags) ? [...rule.tags] : [];
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
    return { ...rule, tags };
  });
}

export function sanitizeCoreRules(
  coreName: string,
  rulesJson: Record<string, unknown>,
): Record<string, unknown> {
  assertNoAdvancedMeta(rulesJson);
  const rules = sanitizeRules(ensureRulesArray(rulesJson));
  const coreTag = mapCoreNameToTag(coreName);
  const taggedRules = coreTag ? applyCoreTag(rules, coreTag) : rules;
  return { meta: { name: coreName }, rules: taggedRules };
}

export function sanitizeTemplateRules(
  templateName: string,
  rulesJson: Record<string, unknown>,
): Record<string, unknown> {
  assertNoAdvancedMeta(rulesJson);
  const rules = sanitizeRules(ensureRulesArray(rulesJson));
  return { meta: { name: templateName }, rules };
}

function mapCoreNameToTag(coreName: string): string | null {
  const lower = coreName.toLowerCase();
  if (lower.includes('sqli')) return 'sqli';
  if (lower.includes('xss')) return 'xss';
  if (lower.includes('rce')) return 'rce';
  if (lower.includes('lfi')) return 'lfi';
  if (lower.includes('dir') || lower.includes('traversal'))
    return 'dir_traversal';
  if (lower.includes('ua')) return 'user_agent';
  return null;
}
