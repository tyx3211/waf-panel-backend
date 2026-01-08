export const RULE_TARGETS = [
  'URI',
  'ARGS_COMBINED',
  'BODY',
  'HEADER',
  'CLIENT_IP',
  'ALL_PARAMS',
] as const;
export type RuleTarget = (typeof RULE_TARGETS)[number];

export const RULE_MATCHES = ['CONTAINS', 'EXACT', 'REGEX', 'CIDR'] as const;
export type RuleMatch = (typeof RULE_MATCHES)[number];

export const RULE_ACTIONS = ['DENY', 'LOG', 'BYPASS'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export interface RuleObject {
  id: number;
  target: RuleTarget | RuleTarget[];
  match: RuleMatch;
  pattern: string | string[];
  action: RuleAction;
  score?: number;
  tags?: string[];
  caseless?: boolean;
  negate?: boolean;
  headerName?: string;
}

export function sanitizeRules(input?: Record<string, unknown>[]): RuleObject[] {
  if (!input || input.length === 0) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error('rules must be an array');
  }
  return input.map((rule, idx) => sanitizeRule(rule, idx));
}

function sanitizeRule(rule: Record<string, unknown>, idx: number): RuleObject {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`rule[${idx}] must be an object`);
  }
  const id = rule.id;
  if (!Number.isInteger(id)) {
    throw new Error(`rule[${idx}].id must be an integer`);
  }
  const ruleId = id as number;

  const targetList = normalizeTarget(rule.target, idx);
  const headerName = rule.headerName;
  if (targetList.includes('HEADER')) {
    if (!headerName || typeof headerName !== 'string') {
      throw new Error(
        `rule[${idx}].headerName is required when target contains HEADER`,
      );
    }
  }
  const headerNameStr = typeof headerName === 'string' ? headerName : undefined;

  const match = normalizeMatch(rule.match, idx);
  const pattern = normalizePattern(rule.pattern, idx);
  const action = normalizeAction(rule.action, idx);

  const caseless = rule.caseless;
  if (caseless !== undefined && typeof caseless !== 'boolean') {
    throw new Error(`rule[${idx}].caseless must be boolean if provided`);
  }
  const negate = rule.negate;
  if (negate !== undefined && typeof negate !== 'boolean') {
    throw new Error(`rule[${idx}].negate must be boolean if provided`);
  }
  const score = rule.score;
  if (score !== undefined && (typeof score !== 'number' || score < 0)) {
    throw new Error(`rule[${idx}].score must be >=0 number if provided`);
  }
  const tags = rule.tags;
  if (tags !== undefined) {
    if (
      !Array.isArray(tags) ||
      tags.some((t: unknown) => typeof t !== 'string')
    ) {
      throw new Error(`rule[${idx}].tags must be string array if provided`);
    }
  }

  const normalizedTarget: RuleTarget | RuleTarget[] =
    targetList.length === 1 ? targetList[0] : targetList;
  const normalizedPattern =
    Array.isArray(pattern) && pattern.length === 1 ? pattern[0] : pattern;

  return {
    id: ruleId,
    target: normalizedTarget,
    match,
    pattern: normalizedPattern,
    action,
    headerName: normalizedTarget === 'HEADER' ? headerNameStr : undefined,
    caseless,
    negate,
    score,
    tags,
  };
}

function normalizeTarget(target: unknown, idx: number): RuleTarget[] {
  let list: unknown[];
  if (typeof target === 'string') {
    list = [target];
  } else if (Array.isArray(target)) {
    const targetList = target as unknown[];
    list = targetList.slice();
  } else {
    throw new Error(`rule[${idx}].target must be string or string[]`);
  }
  if (
    list.some(
      (t) => typeof t !== 'string' || !RULE_TARGETS.includes(t as RuleTarget),
    )
  ) {
    throw new Error(
      `rule[${idx}].target must be one of ${RULE_TARGETS.join(', ')}`,
    );
  }
  if (list.includes('HEADER') && list.length !== 1) {
    throw new Error(`rule[${idx}].target contains HEADER so length must be 1`);
  }
  return list.map((t) => t as RuleTarget);
}

function normalizeMatch(raw: unknown, idx: number): RuleMatch {
  if (typeof raw !== 'string' || !RULE_MATCHES.includes(raw as RuleMatch)) {
    throw new Error(
      `rule[${idx}].match must be one of ${RULE_MATCHES.join(', ')}`,
    );
  }
  return raw as RuleMatch;
}

function normalizePattern(raw: unknown, idx: number): string[] {
  if (typeof raw === 'string') {
    return [raw];
  }
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
    if (raw.length === 0) {
      throw new Error(`rule[${idx}].pattern cannot be empty array`);
    }
    return [...raw];
  }
  throw new Error(`rule[${idx}].pattern must be string or string[]`);
}

function normalizeAction(raw: unknown, idx: number): RuleAction {
  if (typeof raw !== 'string' || !RULE_ACTIONS.includes(raw as RuleAction)) {
    throw new Error(
      `rule[${idx}].action must be one of ${RULE_ACTIONS.join(', ')}`,
    );
  }
  return raw as RuleAction;
}
