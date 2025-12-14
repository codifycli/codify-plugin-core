import { ChangeSet } from './change-set.js';
import { ParameterOperation, ResourceOperation } from 'codify-schemas';
import { describe, expect, it } from 'vitest';
import { ParsedResourceSettings } from '../resource/parsed-resource-settings.js';

describe('Change set tests', () => {
  it ('Correctly diffs two resource configs (modify)', () => {
    const after = {
      propA: 'before',
      propB: 'before'
    }

    const before = {
      propA: 'after',
      propB: 'after'
    }

    const cs = ChangeSet.calculateModification(after, before);
    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.operation).to.eq(ResourceOperation.RECREATE)
  })

  it ('Correctly diffs two resource configs (add)', () => {
    const after = {
      propA: 'before',
      propB: 'after'
    }

    const before = {
      propA: 'after',
    }

    const cs = ChangeSet.calculateModification(after, before);
    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.ADD);
    expect(cs.operation).to.eq(ResourceOperation.RECREATE)

  })

  it ('Correctly diffs two resource configs (remove)', () => {
    const after = {
      propA: 'after',
    }

    const before = {
      propA: 'before',
      propB: 'before'
    }

    const cs = ChangeSet.calculateModification(after, before);
    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.REMOVE);
    expect(cs.operation).to.eq(ResourceOperation.RECREATE)
  })

  it ('Correctly diffs two resource configs (no-op)', () => {
    const after = {
      propA: 'prop',
    }

    const before = {
      propA: 'prop',
    }

    const cs = ChangeSet.calculateModification(after, before);
    expect(cs.parameterChanges.length).to.eq(1);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.NOOP);
    expect(cs.operation).to.eq(ResourceOperation.NOOP)
  })

  it('Correctly diffs two resource configs (create)', () => {
    const cs = ChangeSet.create({
      propA: 'prop',
      propB: 'propB'
    });

    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.ADD);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.ADD);
    expect(cs.operation).to.eq(ResourceOperation.CREATE)
  })

  it('Correctly diffs two resource configs (destory)', () => {
    const cs = ChangeSet.destroy({
      propA: 'prop',
      propB: 'propB',
    });

    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.REMOVE);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.REMOVE);
    expect(cs.operation).to.eq(ResourceOperation.DESTROY)
  })

  it ('handles simple arrays', () => {
    const before = {
      propA: ['a', 'b', 'c'],
    }

    const after = {
      propA: ['b', 'a', 'c'],
    }

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { type: 'array' }
      }
    }).parameterSettings

    const cs = ChangeSet.calculateModification(after, before, parameterSettings);
    expect(cs.parameterChanges.length).to.eq(1);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.NOOP);
    expect(cs.operation).to.eq(ResourceOperation.NOOP)
  })

  it('handles simple arrays 2', () => {
    const after = {
      propA: ['a', 'b', 'c'],
    }

    const before = {
      propA: ['b', 'a'],
    }

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { type: 'array' }
      }
    }).parameterSettings

    const cs = ChangeSet.calculateModification(after, before, parameterSettings);
    expect(cs.parameterChanges.length).to.eq(1);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.operation).to.eq(ResourceOperation.RECREATE)
  })

  it('determines the order of operations with canModify 1', () => {
    const after = {
      propA: 'after',
    }

    const before = {
      propA: 'before',
      propB: 'before'
    }

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { canModify: true }
      }
    }).parameterSettings

    const cs = ChangeSet.calculateModification(after, before, parameterSettings);
    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.REMOVE);
    expect(cs.operation).to.eq(ResourceOperation.RECREATE)
  })

  it('determines the order of operations with canModify 2', () => {
    const after = {
      propA: 'after',
    }

    const before = {
      propA: 'before',
      propB: 'before'
    }

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { canModify: true },
        propB: { canModify: true }
      },
    }).parameterSettings

    const cs = ChangeSet.calculateModification<any>(after, before, parameterSettings);
    expect(cs.parameterChanges.length).to.eq(2);
    expect(cs.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
    expect(cs.parameterChanges[1].operation).to.eq(ParameterOperation.REMOVE);
    expect(cs.operation).to.eq(ResourceOperation.MODIFY)
  })


  it('correctly determines array equality', () => {
    const arrA = ['a', 'b', 'd'];
    const arrB = ['a', 'b', 'd'];

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { type: 'array' }
      },
    }).parameterSettings


    const result = ChangeSet.calculateModification({ propA: arrA }, { propA: arrB }, parameterSettings)

    expect(result.operation).to.eq(ResourceOperation.NOOP);
  })

  it('correctly determines array equality 2', () => {
    const arrA = ['a', 'b'];
    const arrB = ['a', 'b', 'd'];

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { type: 'array' }
      },
    }).parameterSettings

    const result = ChangeSet.calculateModification({ propA: arrA }, { propA: arrB }, parameterSettings)

    expect(result.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
  })

  it('correctly determines array equality 3', () => {
    const arrA = ['b', 'a', 'd'];
    const arrB = ['a', 'b', 'd'];

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: { type: 'array' }
      },
    }).parameterSettings

    const result = ChangeSet.calculateModification({ propA: arrA }, { propA: arrB }, parameterSettings)

    expect(result.parameterChanges[0].operation).to.eq(ParameterOperation.NOOP);
  })

  it('correctly determines array equality 4', () => {
    const arrA = [{ key1: 'a' }, { key1: 'a' }, { key1: 'a' }];
    const arrB = [{ key1: 'a' }, { key1: 'a' }, { key1: 'b' }];

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: {
          type: 'array',
          isElementEqual: (a, b) => a.key1 === b.key1
        }
      },
    }).parameterSettings


    const result = ChangeSet.calculateModification({ propA: arrA }, { propA: arrB }, parameterSettings)

    expect(result.parameterChanges[0].operation).to.eq(ParameterOperation.MODIFY);
  })

  it('correctly determines array equality 5', () => {
    const arrA = [{ key1: 'b' }, { key1: 'a' }, { key1: 'a' }];
    const arrB = [{ key1: 'a' }, { key1: 'a' }, { key1: 'b' }];

    const parameterSettings = new ParsedResourceSettings({
      id: 'type',
      parameterSettings: {
        propA: {
          type: 'array',
          isElementEqual: (a, b) => a.key1 === b.key1
        }
      },
    }).parameterSettings

    const result = ChangeSet.calculateModification({ propA: arrA }, { propA: arrB }, parameterSettings)

    expect(result.parameterChanges[0].operation).to.eq(ParameterOperation.NOOP);
  })
})
