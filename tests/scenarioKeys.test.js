import { SCENARIO_DATA as koScenarios } from '../lang/ko.js';
import { SCENARIO_DATA as jaScenarios } from '../lang/ja.js';

const requiredKeys = [
  'id',
  'title',
  'description',
  'baseContext',
  'baseContext_swapped',
  'starters_userAsPrimary',
  'starters_userAsOther',
];

function validateScenarioData(data) {
  expect(Array.isArray(data)).toBe(true);
  data.forEach(category => {
    expect(Array.isArray(category.items)).toBe(true);
    category.items.forEach(item => {
      requiredKeys.forEach(key => {
        expect(item).toHaveProperty(key);
      });
    });
  });
}

describe('Scenario data structure', () => {
  test('ko.js scenarios contain required keys', () => {
    validateScenarioData(koScenarios);
  });

  test('ja.js scenarios contain required keys', () => {
    validateScenarioData(jaScenarios);
  });
});
