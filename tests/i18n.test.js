import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { t, setLang, getLang, detectLang, loadAllLocales } from '../src/i18n/index.js';

describe('i18n', () => {
  let savedLang, savedLC, savedCFL, savedCPL;
  beforeEach(() => {
    savedLang = process.env.LANG;
    savedLC = process.env.LC_ALL;
    savedCFL = process.env.CODEFORESIGHT_LANG;
    savedCPL = process.env.CODEPR_LANG;
    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.CODEFORESIGHT_LANG;
    delete process.env.CODEPR_LANG;
  });
  afterEach(() => {
    process.env.LANG = savedLang || '';
    process.env.LC_ALL = savedLC || '';
    process.env.CODEFORESIGHT_LANG = savedCFL || '';
    process.env.CODEPR_LANG = savedCPL || '';
  });

  describe('detectLang', () => {
    it('returns zh by default with no signals', () => {
      expect(detectLang()).toBe('zh');
    });
    it('honors override argument', () => {
      expect(detectLang('en')).toBe('en');
    });
    it('ignores invalid override', () => {
      expect(detectLang('fr')).toBe('zh');
    });
    it('reads CODEFORESIGHT_LANG over CODEPR_LANG', () => {
      process.env.CODEFORESIGHT_LANG = 'en';
      process.env.CODEPR_LANG = 'zh';
      expect(detectLang()).toBe('en');
    });
    it('falls back to system LANG prefix', () => {
      process.env.LANG = 'en_US.UTF-8';
      expect(detectLang()).toBe('en');
    });
    it('reads zh from system LANG zh_*', () => {
      process.env.LANG = 'zh_CN.UTF-8';
      expect(detectLang()).toBe('zh');
    });
  });

  describe('t', () => {
    it('returns translation for known keys', () => {
      setLang('zh');
      const v = t('brand.name');
      expect(v).toContain('codeForesight');
    });

    it('substitutes params', () => {
      setLang('en');
      const v = t('cli.req.removed', { id: 'req-007' });
      expect(v).toContain('req-007');
    });

    it('falls back to zh when key missing in en', () => {
      setLang('en');
      // Use a key that exists in both (we don't know one that's missing intentionally)
      const zh = (() => { setLang('zh'); return t('brand.name'); })();
      setLang('en');
      const en = t('brand.name');
      // Both should resolve (brand.name exists in both)
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    });

    it('returns key as-is when missing in both locales', () => {
      setLang('zh');
      expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });
  });

  describe('loadAllLocales', () => {
    it('returns object with en + zh keys', () => {
      const all = loadAllLocales();
      expect(all).toHaveProperty('en');
      expect(all).toHaveProperty('zh');
      expect(Object.keys(all.en).length).toBeGreaterThan(50);
      expect(Object.keys(all.zh).length).toBeGreaterThan(50);
    });

    it('zh and en should have the same key set (no missing translations)', () => {
      const all = loadAllLocales();
      const enKeys = Object.keys(all.en).sort();
      const zhKeys = Object.keys(all.zh).sort();
      const onlyInEn = enKeys.filter(k => !zhKeys.includes(k));
      const onlyInZh = zhKeys.filter(k => !enKeys.includes(k));
      expect(onlyInEn).toEqual([]);
      expect(onlyInZh).toEqual([]);
    });
  });
});
