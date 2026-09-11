import { REQUIREMENT_FIELDS } from './requirements-fields.js'

// Shared semantic mapping for recognition, backend Profile projection and the UI.
// Changes to this definition participate in REQUIREMENTS_RULES and invalidate review.
export const CONDENSER_MAPPING = {
  id: 'mche.condenser.requirements', version: 2,
  sections: [
    { id: 'refrigerant', label: 'Refrigerant Side · 冷媒侧' },
    { id: 'inlet', label: 'Heat Exchange Inlet · 换热器入口' },
    { id: 'outlet', label: 'Heat Exchange Outlet · 换热器出口' },
    { id: 'air', label: 'Air Side · 空气侧' },
  ],
  fields: {
    refrigerant: { section: 'refrigerant', target: 'Refrigerant', pattern: '^(refrigerant|冷媒|制冷剂)$' },
    refPressure: { section: 'inlet', target: 'Pressure', pattern: '^(entering refrigerant (abs\\.? |absolute )?pressure|冷媒入口绝对压力)' },
    refTemperature: { section: 'inlet', target: 'Temperature', pattern: '^(entering refrigerant temperature|冷媒入口温度)' },
    refMassFlow: { section: 'inlet', target: 'Mass Flow', pattern: '^(refrigerant mass flow rate|冷媒质量流量)' },
    refQuality: { section: 'inlet', target: 'Quality', pattern: '^(entering refrigerant (quality|dryness)|quality|冷媒入口干度)$' },
    refSatTemperature: { section: 'inlet', target: 'Sat.T', pattern: '^(condensing temperature|冷凝温度)' },
    refSuperheat: { section: 'inlet', target: 'SH(+)', pattern: '^(entering refrigerant superheat|superheat|sh\\s*\\(\\+\\)|冷媒入口过热度)$' },
    refSubcooling: { section: 'outlet', target: 'SC(-)', pattern: '^(leaving refrigerant subcooling|冷媒出口过冷度)' },
    refOutletTemperature: { section: 'outlet', target: 'Temperature', pattern: '^(leaving refrigerant temperature|冷媒出口温度)' },
    airPressure: { section: 'air', target: 'Pressure', pattern: '^(inlet air (abs\\.? |absolute )?pressure|空气入口绝对压力)' },
    airTemperature: { section: 'air', target: 'Dry Bulb', pattern: '^(inlet air temperature|空气入口干球温度)' },
    airHumidity: { section: 'air', target: 'RH', pattern: '^(air relative humidity|空气相对湿度)' },
    airVolumeFlow: { section: 'air', target: 'Volume Flow', pattern: '^(air flow|空气体积流量)$' },
    airWetBulb: { section: 'air', target: 'Wet Bulb', pattern: '^inlet air wet bulb' },
    airHumidityRatio: { section: 'air', target: 'Humidity Ratio', pattern: '^air humidity ratio' },
    airVelocity: { section: 'air', target: 'Face Velocity', pattern: '^air speed' },
  },
  superheat: { id: 'inlet-minus-saturation.v1', field: 'refSuperheat', inputs: ['refTemperature', 'refSatTemperature'],
    formula: 'SH(+) = refTemperature[K] - refSatTemperature[K]', unit: 'K', toleranceK: 1e-6 },
  subcooling: { profile: 'nonnegative_temperature_difference', dllRule: 'SC(-) = -refSubcooling[K]', executionEnabled: false },
}

export function profileDraft(assessment) {
  return { mappingId: CONDENSER_MAPPING.id, mappingVersion: CONDENSER_MAPPING.version,
    sections: CONDENSER_MAPPING.sections.map(section => ({ ...section,
      fields: Object.entries(CONDENSER_MAPPING.fields).filter(([, spec]) => spec.section === section.id).map(([key, spec]) => {
        const entry = assessment.entries[key] ?? null
        const records = assessment.rows.filter(row => row.key === key)
        return { key, label: REQUIREMENT_FIELDS[key].label, target: spec.target, entry, role: assessment.roles[key] ?? 'reference',
          issues: assessment.fieldIssues[key] ?? (entry ? [] : ['未填写']), records: records.map(row => row.id),
          unitBasis: records.map(row => ({ recordId: row.id, original: row.unitBasis, edited: row.edited })),
          ...(key === 'refSuperheat' ? { derivation: assessment.derived[0] } : {}),
          ...(key === 'refSubcooling' ? { signConvention: CONDENSER_MAPPING.subcooling } : {}) }
      }) })),
    missing: assessment.missing, executionSupported: assessment.executionSupported }
}
