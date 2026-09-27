export const RULES = Object.freeze({ version: '2026-09-26', bno: 180, citizenship: 450, finalYear: 90,
  zone: 'Europe/London', thresholds: [70, 85, 95] as readonly number[], sources: [
    ['BNO visa: settle in the UK', 'https://www.gov.uk/british-national-overseas-bno-visa/settle-in-the-uk'],
    ['Appendix Continuous Residence', 'https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-continuous-residence'],
    ['Continuous residence guidance', 'https://www.gov.uk/government/publications/continuous-residence-caseworker-guidance/continuous-residence-guidance-accessible-version'],
    ['Citizenship after ILR', 'https://www.gov.uk/apply-citizenship-indefinite-leave-to-remain'],
    ['Form AN guidance', 'https://www.gov.uk/government/publications/form-an-guidance/form-an-guidance-accessible'],
    ['Naturalisation caseworker guidance', 'https://www.gov.uk/government/publications/naturalisation-as-a-british-citizen-by-discretion-nationality-policy-guidance/naturalisation-as-a-british-citizen-by-discretion-accessible'],
  ] as readonly (readonly [string, string])[] });
export function warningLevel(value: number, limit: number, thresholds: readonly number[] = RULES.thresholds): string {
  const percent = value / limit * 100;
  return percent > 100 ? 'Exceeded' : percent >= thresholds[2] ? 'Critical' : percent >= thresholds[1] ? 'High' : percent >= thresholds[0] ? 'Caution' : 'Safe';
}
