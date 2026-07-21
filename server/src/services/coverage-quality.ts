import type { CoverageGateCheck, CoverageGateResult, CoverageQualityRecord } from '../domain/coverage-quality.js';
import { z } from 'zod';

type MetricKey = keyof CoverageQualityRecord['metrics'];

export const coverageQualityUpdateSchema = z.object({
  search_sample_coverage_rate: z.number().min(0).max(1).optional(),
  branch_mismatch_rate: z.number().min(0).max(1).optional(),
  visit_conformity_rate: z.number().min(0).max(1).optional(),
  incident_free_weeks: z.number().min(0).max(520).optional(),
  provider_terms_reviewed: z.boolean().optional(),
  privacy_reviewed: z.boolean().optional(),
  postgis_rehearsal_passed: z.boolean().optional(),
  evidence_note: z.string().trim().min(10).max(500)
}).superRefine((value, context) => {
  const metricKeys = Object.keys(value).filter(key => key !== 'evidence_note');
  if (!metricKeys.length) context.addIssue({ code: 'custom', path: [], message: 'at least one manual quality metric is required' });
});

function minimumCheck(
  record: CoverageQualityRecord,
  key: MetricKey,
  code: string,
  label: string,
  minimum: number,
  target: string,
  source: CoverageGateCheck['source'] = 'database'
): CoverageGateCheck {
  const value = record.metrics[key];
  return { code, label, value, target, passed: typeof value === 'number' && value >= minimum, source };
}

function maximumCheck(
  record: CoverageQualityRecord,
  key: MetricKey,
  code: string,
  label: string,
  maximum: number,
  target: string,
  source: CoverageGateCheck['source'] = 'database'
): CoverageGateCheck {
  const value = record.metrics[key];
  return { code, label, value, target, passed: typeof value === 'number' && value <= maximum, source };
}

function booleanCheck(
  record: CoverageQualityRecord,
  key: MetricKey,
  code: string,
  label: string
): CoverageGateCheck {
  const value = record.metrics[key];
  return { code, label, value, target: '已通过', passed: value === true, source: 'manual' };
}

function gate(policyVersion: string, checks: CoverageGateCheck[]): CoverageGateResult {
  return { policyVersion, eligible: checks.every(check => check.passed), checks };
}

export function evaluateBetaGate(record: CoverageQualityRecord): CoverageGateResult {
  return gate('coverage-beta-v1', [
    minimumCheck(record, 'publishedRestaurants', 'published_restaurants', '已发布餐厅', 30, '>= 30'),
    minimumCheck(record, 'searchSampleCoverageRate', 'search_coverage', '2 公里测试点覆盖率', 0.6, '>= 60%', 'manual'),
    minimumCheck(record, 'recentVerificationRate', 'recent_verification', '90 天内核心字段核验率', 0.8, '>= 80%'),
    minimumCheck(record, 'coreCompletenessRate', 'core_completeness', '核心字段完整率', 0.85, '>= 85%'),
    minimumCheck(record, 'providerReferenceRate', 'provider_references', 'Provider ID 关联率', 0.9, '>= 90%'),
    maximumCheck(record, 'pendingHighConfidenceMatches', 'pending_dedup', '高置信重复待处理', 0, '= 0'),
    maximumCheck(record, 'branchMismatchRate', 'branch_mismatch', '抽样分店错配率', 0.02, '<= 2%', 'manual'),
    minimumCheck(record, 'visitConformityRate', 'visit_conformity', '抽样到店符合率', 0.7, '>= 70%', 'manual'),
    minimumCheck(record, 'highPriorityFeedbackSlaRate', 'feedback_sla', '高优纠错五工作日处理率', 0.8, '>= 80%'),
    minimumCheck(record, 'incidentFreeWeeks', 'incident_free', '严重质量事故连续无发生', 2, '>= 2 周', 'manual'),
    booleanCheck(record, 'providerTermsReviewed', 'provider_terms', '地图 Provider 条款评审'),
    booleanCheck(record, 'privacyReviewed', 'privacy_review', '隐私评审'),
    booleanCheck(record, 'postgisRehearsalPassed', 'postgis_rehearsal', 'PostGIS 迁移回滚演练')
  ]);
}

export function evaluateLiveGate(record: CoverageQualityRecord): CoverageGateResult {
  return gate('coverage-live-v1', [
    minimumCheck(record, 'publishedRestaurants', 'published_restaurants', '已发布餐厅', 100, '>= 100'),
    minimumCheck(record, 'searchSampleCoverageRate', 'search_coverage', '2 公里测试点覆盖率', 0.8, '>= 80%', 'manual'),
    minimumCheck(record, 'recentVerificationRate', 'recent_verification', '90 天内核心字段核验率', 0.7, '>= 70%'),
    minimumCheck(record, 'coreCompletenessRate', 'core_completeness', '核心字段完整率', 0.85, '>= 85%'),
    minimumCheck(record, 'providerReferenceRate', 'provider_references', 'Provider ID 关联率', 0.95, '>= 95%'),
    maximumCheck(record, 'pendingHighConfidenceMatches', 'pending_dedup', '高置信重复待处理', 0, '= 0'),
    maximumCheck(record, 'branchMismatchRate', 'branch_mismatch', '高曝光分店错配率', 0.01, '<= 1%', 'manual'),
    minimumCheck(record, 'visitConformityRate', 'visit_conformity', '抽样到店符合率', 0.75, '>= 75%', 'manual'),
    minimumCheck(record, 'highPriorityFeedbackSlaRate', 'feedback_sla', '高优纠错五工作日处理率', 0.9, '>= 90%'),
    minimumCheck(record, 'incidentFreeWeeks', 'incident_free', '严重质量事故连续无发生', 2, '>= 2 周', 'manual'),
    booleanCheck(record, 'providerTermsReviewed', 'provider_terms', '地图 Provider 条款评审'),
    booleanCheck(record, 'privacyReviewed', 'privacy_review', '隐私评审'),
    booleanCheck(record, 'postgisRehearsalPassed', 'postgis_rehearsal', 'PostGIS 迁移回滚演练')
  ]);
}

export function toCoverageQualityDto(record: CoverageQualityRecord) {
  return {
    area: { id: record.areaId, name: record.areaName, city_code: record.cityCode, status: record.status },
    measured_at: record.measuredAt,
    metrics: {
      published_restaurants: record.metrics.publishedRestaurants,
      recent_verification_rate: record.metrics.recentVerificationRate,
      core_completeness_rate: record.metrics.coreCompletenessRate,
      provider_reference_rate: record.metrics.providerReferenceRate,
      search_sample_coverage_rate: record.metrics.searchSampleCoverageRate,
      branch_mismatch_rate: record.metrics.branchMismatchRate,
      visit_conformity_rate: record.metrics.visitConformityRate,
      high_priority_feedback_sla_rate: record.metrics.highPriorityFeedbackSlaRate,
      incident_free_weeks: record.metrics.incidentFreeWeeks,
      pending_high_confidence_matches: record.metrics.pendingHighConfidenceMatches,
      provider_terms_reviewed: record.metrics.providerTermsReviewed,
      privacy_reviewed: record.metrics.privacyReviewed,
      postgis_rehearsal_passed: record.metrics.postgisRehearsalPassed
    },
    gates: { beta: evaluateBetaGate(record), live: evaluateLiveGate(record) }
  };
}
