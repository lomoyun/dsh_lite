import { REFRIGERANT_CATEGORIES, CONCENTRATION_BASES } from '../../../src/catalogs/refrigerants.mjs'
export { REFRIGERANT_CATEGORIES, CONCENTRATION_BASES }
export const REFRIGERANT_INPUT_FIELDS = {
  refrigerantCategory: { component: 'refrigerant', label: '冷媒类别', text: true, unit: '', options: REFRIGERANT_CATEGORIES, catalogField: 'categoryKey' },
  refrigerantConcentration: { component: 'refrigerant', label: '冷媒浓度约束', unit: '%', units: { '%': 1 }, range: true, allowZero: true, max: 100, catalogField: 'concentrationPercent' },
  refrigerantConcentrationBasis: { component: 'refrigerant', label: '冷媒浓度基准', text: true, unit: '', options: CONCENTRATION_BASES, catalogField: 'concentrationBasis' },
}
export const REFRIGERANT_CONSTRAINT_FIELDS = [...Object.keys(REFRIGERANT_INPUT_FIELDS), 'application', 'operatingConditions']
