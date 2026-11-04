import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StockAdjustmentDto } from './inventory.dto';

describe('inventory request policy', () => {
  it.each([0, 1.5, -2147483649, 2147483648, '1', null])(
    'rejects invalid/non-integer delta %s',
    (quantityDelta) => {
      expect(
        validateSync(
          plainToInstance(StockAdjustmentDto, {
            quantityDelta,
            reason: 'Adjustment',
          }),
        ),
      ).not.toHaveLength(0);
    },
  );
  it.each(['', ' ', 'bad\nreason', 'a'.repeat(1001), null])(
    'requires bounded safe nonblank reason',
    (reason) => {
      expect(
        validateSync(
          plainToInstance(StockAdjustmentDto, { quantityDelta: 1, reason }),
        ),
      ).not.toHaveLength(0);
    },
  );
  it('accepts signed integer extremes and trims only reason', () => {
    for (const quantityDelta of [-2147483648, -1, 1, 2147483647]) {
      const dto = plainToInstance(StockAdjustmentDto, {
        quantityDelta,
        reason: '  Adjustment  ',
      });
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.reason).toBe('Adjustment');
    }
  });
});
