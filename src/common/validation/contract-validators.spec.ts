import { isVndAmount } from './contract-validators';
import { strictValidationPipe } from '../http/validation.pipe';

describe('numeric boundary safety', () => {
  it.each([
    NaN,
    Infinity,
    -Infinity,
    1.5,
    0,
    1,
    'NaN',
    'Infinity',
    '-1',
    '1e3',
    '01',
    '1.5',
    ' 1',
    '9223372036854775808',
    '9'.repeat(1000),
    null,
    {},
    [],
  ])('rejects invalid VND before bigint conversion', (value) => {
    expect(isVndAmount(value)).toBe(false);
  });
  it('accepts exact supported bounds as decimal strings', () => {
    expect(isVndAmount('1')).toBe(true);
    expect(isVndAmount('9223372036854775807')).toBe(true);
  });
  it('does not invoke Nest primitive Number/Boolean coercion', async () => {
    const pipe = strictValidationPipe();
    expect(
      await pipe.transform('1e2', {
        type: 'query',
        metatype: Number,
        data: 'quantity',
      }),
    ).toBe('1e2');
    expect(
      await pipe.transform('false', {
        type: 'query',
        metatype: Boolean,
        data: 'enabled',
      }),
    ).toBe('false');
  });
});
