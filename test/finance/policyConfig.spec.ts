import { expect } from 'chai';
import { financePolicyConfig } from '../../src/finance';

describe('financePolicyConfig', () => {
  it('has a sensible manager/director threshold relationship', () => {
    expect(financePolicyConfig.managerOnlyMax).to.be.lessThan(
      financePolicyConfig.managerAndDirectorMin,
    );
  });

  it('disallows at least one spend type', () => {
    expect(financePolicyConfig.disallowedSpendTypes.length).to.be.greaterThan(0);
  });
});
