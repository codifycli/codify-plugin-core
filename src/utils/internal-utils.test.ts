import { describe, expect, it } from 'vitest';
import { addVariablesToPath, resolvePathWithVariables, splitUserConfig } from './internal-utils.js';
import os from 'node:os';

describe('Utils tests', () => {
  it('Can split a config correctly', () => {
    const { parameters, coreParameters } = splitUserConfig({
      type: 'type',
      name: 'name',
      dependsOn: ['a', 'b', 'c'],
      propA: 'propA',
      propB: 'propB',
      propC: 'propC',
      propD: 'propD',
    })

    expect(coreParameters).toMatchObject({
      type: 'type',
      name: 'name',
      dependsOn: ['a', 'b', 'c'],
    })

    expect(parameters).toMatchObject({
      propA: 'propA',
      propB: 'propB',
      propC: 'propC',
      propD: 'propD',
    })
  })

  it('Can remove variables from a path', () => {
    const testPath1 = '$HOME/my/path';
    const result1 = resolvePathWithVariables(testPath1);

    const home = os.homedir();
    expect(result1).to.eq(home + '/my/path');


    const testPath2 = '/var$HOME/my/path';
    const result2 = resolvePathWithVariables(testPath2);
    expect(result2).to.eq('/var' + home + '/my/path');
  })

  it('Can add variables to a path (ignores home)', () => {
    const testPath1 = os.homedir() + '/my/path';
    const result1 = addVariablesToPath(testPath1);

    const home = os.homedir();
    expect(result1).to.eq(home + '/my/path');
  })
})
