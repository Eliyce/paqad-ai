import {
  booleanEnumMap,
  checkYamlValue,
  COMMA_LIST,
  fromYamlValue,
  personalValue,
  teamConfigHome,
  toYamlValue,
  yamlDefault,
  yamlEnumOf,
  ZERO_IS_AUTO,
  type TranslatableSpec,
} from '@/core/team-config-values.js';

const onOff = booleanEnumMap('on', 'off');

describe('team config value translation', () => {
  it('keeps a value that is neither true nor false as it was', () => {
    expect(onOff.toYaml(' yes ')).toBe('on');
    expect(onOff.toYaml('no')).toBe('off');
    expect(onOff.toYaml(' maybe ')).toBe('maybe');
    expect(onOff.fromYaml(true)).toBe('true');
    expect(onOff.fromYaml(false)).toBe('false');
    expect(onOff.fromYaml('off')).toBe('false');
    expect(onOff.fromYaml('later')).toBe('later');
  });

  it('turns 0 into auto, keeps other numbers and leaves text alone', () => {
    expect(ZERO_IS_AUTO.toYaml('0')).toBe('auto');
    expect(ZERO_IS_AUTO.toYaml('4')).toBe(4);
    expect(ZERO_IS_AUTO.toYaml('many')).toBe('many');
    expect(ZERO_IS_AUTO.toYaml('  ')).toBe('');
    expect(ZERO_IS_AUTO.fromYaml('auto')).toBe('0');
    expect(ZERO_IS_AUTO.fromYaml(3)).toBe('3');
  });

  it('reads a comma list from a YAML list or a single value', () => {
    expect(COMMA_LIST.toYaml('a, ,b')).toEqual(['a', 'b']);
    expect(COMMA_LIST.fromYaml(['a', ' ', 2])).toBe('a,2');
    expect(COMMA_LIST.fromYaml(' a,b ')).toBe('a,b');
  });

  it('names a setting that has no home', () => {
    expect(() => teamConfigHome('no_such_setting')).toThrow(
      'Setting no_such_setting has no home in the team YAML files.',
    );
  });

  it('translates plain booleans, numbers and strings both ways', () => {
    const bool: TranslatableSpec = { type: 'boolean', default: true };
    expect(toYamlValue(bool, 'on')).toBe(true);
    expect(toYamlValue(bool, 'off')).toBe(false);
    expect(toYamlValue(bool, 'sometimes')).toBe('sometimes');
    const num: TranslatableSpec = { type: 'number', default: undefined };
    expect(toYamlValue(num, '7')).toBe(7);
    expect(toYamlValue(num, '')).toBe('');
    expect(toYamlValue(num, 'x')).toBe('x');
    expect(yamlDefault(num)).toBeUndefined();
    expect(yamlDefault(bool)).toBe(true);
    expect(fromYamlValue(num, 7)).toBe('7');
    expect(fromYamlValue({ type: 'string', default: '', yaml: onOff }, 'on')).toBe('true');
  });

  it('lists the allowed YAML values for enums and none for lists and auto numbers', () => {
    expect(yamlEnumOf({ type: 'string', default: '', yaml: COMMA_LIST })).toBeUndefined();
    expect(yamlEnumOf({ type: 'number', default: 0, yaml: ZERO_IS_AUTO })).toBeUndefined();
    expect(yamlEnumOf({ type: 'boolean', default: true, yaml: onOff })).toEqual(['on', 'off']);
    expect(yamlEnumOf({ type: 'string', default: '' })).toBeUndefined();
    expect(yamlEnumOf({ type: 'enum', default: 'a', enumValues: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('checks list, auto-number, enum, boolean, number and single values', () => {
    const list: TranslatableSpec = { type: 'string', default: '', yaml: COMMA_LIST };
    expect(checkYamlValue(list, 'a,b')).toBeNull();
    expect(checkYamlValue(list, ['a', 1])).toBeNull();
    expect(checkYamlValue(list, [{}])).toBe('It must be a list of names.');
    const auto: TranslatableSpec = { type: 'number', default: 0, yaml: ZERO_IS_AUTO };
    expect(checkYamlValue(auto, 'auto')).toBeNull();
    expect(checkYamlValue(auto, '4')).toBeNull();
    expect(checkYamlValue(auto, 'lots')).toBe('It must be a number or auto.');
    const enumSpec: TranslatableSpec = { type: 'enum', default: 'a', enumValues: ['a', 'b'] };
    expect(checkYamlValue(enumSpec, 'b')).toBeNull();
    expect(checkYamlValue(enumSpec, ['a'])).toBe('It must be one of: a, b.');
    const bool: TranslatableSpec = { type: 'boolean', default: true };
    expect(checkYamlValue(bool, false)).toBeNull();
    expect(checkYamlValue(bool, ' Yes ')).toBeNull();
    expect(checkYamlValue(bool, 'perhaps')).toBe('It must be true or false.');
    expect(checkYamlValue(bool, 1)).toBe('It must be true or false.');
    const num: TranslatableSpec = { type: 'number', default: 1 };
    expect(checkYamlValue(num, 2)).toBeNull();
    expect(checkYamlValue(num, Infinity)).toBe('It must be a number.');
    expect(checkYamlValue(num, ' ')).toBe('It must be a number.');
    const text: TranslatableSpec = { type: 'string', default: '' };
    expect(checkYamlValue(text, 'x')).toBeNull();
    expect(checkYamlValue(text, { a: 1 })).toBe('It must be a single value.');
  });

  it('reads a personal value through the YAML map unless the setting is a list or has none', () => {
    expect(personalValue(undefined, 'raw')).toBe('raw');
    expect(personalValue({ type: 'string', default: '', yaml: COMMA_LIST }, 'a, b')).toBe('a, b');
    expect(personalValue({ type: 'boolean', default: true, yaml: onOff }, 'on')).toBe('true');
  });
});
