import {
  applyCoreTag,
  assertNoAdvancedMeta,
  ensureRulesArray,
  RuleValidationError,
  sanitizeCoreRules,
  sanitizeTemplateRules,
} from '../rules-validation';

const baseRule = {
  id: 1,
  target: 'URI',
  match: 'CONTAINS',
  pattern: '/admin',
  action: 'DENY',
} as const;

describe('rules-validation', () => {
  it('rejects advanced meta keys', () => {
    expect(() => assertNoAdvancedMeta({ meta: { extends: ['a'] } })).toThrow(
      RuleValidationError,
    );
  });

  it('ensures rules is array', () => {
    expect(() => ensureRulesArray({ rules: {} as any })).toThrow(
      RuleValidationError,
    );
    expect(ensureRulesArray({ rules: [] })).toEqual([]);
  });

  it('applies core tag when missing', () => {
    const rules = [baseRule];
    const tagged = applyCoreTag(rules, 'sqli');
    expect(tagged[0].tags).toContain('sqli');
  });

  it('sanitizes core rules with tag inferred from name', () => {
    const result = sanitizeCoreRules('core_sqli_rules', {
      rules: [{ ...baseRule, tags: ['base'] }],
    });
    const rule = (result.rules as any[])[0];
    expect(rule.tags).toEqual(expect.arrayContaining(['base', 'sqli']));
    expect(result.meta).toEqual({ name: 'core_sqli_rules' });
  });

  it('sanitizes template rules and strips advanced meta', () => {
    const result = sanitizeTemplateRules('tmpl_ip', { rules: [baseRule] });
    expect(result.meta).toEqual({ name: 'tmpl_ip' });
    expect((result.rules as any[])[0].id).toBe(1);
  });
});
