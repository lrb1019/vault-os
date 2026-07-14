import type VaultOsPlugin from '../main.ts';
import { findClaimEvidenceDebt, type ClaimUsageSource } from '../domain/claim-usage.ts';
import { classifyClaimUsageSource } from '../domain/claim-usage-source.ts';
import { activeClaimEvidenceDebt, diagnoseKnowledgeGraph, type KnowledgeGraphDiagnostics } from '../domain/knowledge-graph-diagnostics.ts';
import { classifyKnowledgeEntity, isKnowledgeEntityContractConfigured } from '../domain/knowledge-entity-contract.ts';
import { identifyProjectEntity } from '../domain/project-entity.ts';
import { isOutputLifecycleConfigured, isPublishedAwaitingReview } from '../domain/output-lifecycle.ts';
import { compareWorkflowInspectionSnapshot, type WorkflowInspectionDiff, type WorkflowInspectionSnapshot, type WorkflowIssueIdentity } from '../domain/workflow-inspection-snapshot.ts';
import { createLegacyVaultProfile, isVaultProfile, matchesScopeRule, type VaultProfile } from '../domain/vault-profile.ts';
import type { WorkflowInspectionSourcePort } from '../ports/WorkflowInspectionSourcePort.ts';

// Bump when a diagnostic rule changes issue meaning or identity.
const WORKFLOW_DIAGNOSTIC_RULESET_REVISION = 5;

export interface WorkflowInspectionResult {
	status: 'ready' | 'blocked';
	reason?: string;
	completedProjectPaths: string[];
	activeClaimEvidenceDebt: Array<{ claimPath: string; usagePaths: string[] }>;
	p0ClaimDebt: Array<{ claimPath: string; usagePaths: string[] }>;
	p0ClaimEvidence: 'unconfigured' | 'configured';
	knowledgeGraph: KnowledgeGraphDiagnostics;
	publishedUnreviewedOutputPaths: string[];
	outputLifecycle: 'unconfigured' | 'configured';
}

export class WorkflowInspectionService {
	private readonly plugin: VaultOsPlugin;
	private readonly source: WorkflowInspectionSourcePort;

	constructor(plugin: VaultOsPlugin, source: WorkflowInspectionSourcePort) {
		this.plugin = plugin;
		this.source = source;
	}

	inspect(): WorkflowInspectionResult {
		const profile = this.getProfile();
		const data = this.source.read(profile);
		if (data.security.status === 'blocked') {
			return {
				status: 'blocked', reason: data.security.reason, completedProjectPaths: [], activeClaimEvidenceDebt: [], p0ClaimDebt: [],
				p0ClaimEvidence: profile.p0ClaimRule && isKnowledgeEntityContractConfigured(profile.knowledgeEntities) ? 'configured' : 'unconfigured',
				knowledgeGraph: { status: 'unconfigured', evidenceWithoutSupports: [], evidenceWithInvalidSupports: [], evidenceWithUnresolvedSupports: [], evidenceWithNonClaimSupports: [], questionsWithoutClaimLinks: [], outputsWithoutClaimLinks: [] },
				publishedUnreviewedOutputPaths: [], outputLifecycle: isOutputLifecycleConfigured(profile.outputLifecycle) ? 'configured' : 'unconfigured'
			};
		}

		const projectEntities = data.projects.flatMap(file => {
			const entity = identifyProjectEntity(file, { entryRule: data.projectEntries }, { aliases: profile.projectStatusAliases });
			return entity ? [{ file, entity }] : [];
		});
		const completedProjectPaths = projectEntities.filter(item => item.entity.status === 'completed').map(item => item.file.path);
		const sources: ClaimUsageSource[] = [
			...projectEntities.map(item => ({ ...item.file, kind: 'project-entity' as const })),
			...(data.outputEntries
				? data.outputs.filter(file => matchesScopeRule(file, data.outputEntries!)).map(file => ({ ...file, kind: classifyClaimUsageSource(file) }))
				: [])
		];
		const outputEntities = data.outputEntries
			? data.outputs.filter(file => matchesScopeRule(file, data.outputEntries!) && classifyClaimUsageSource(file) === 'output')
			: [];
		const knowledgeEntityContract = profile.knowledgeEntities;
		const entityContractConfigured = isKnowledgeEntityContractConfigured(knowledgeEntityContract);
		const claims = entityContractConfigured
			? data.knowledge.filter(file => classifyKnowledgeEntity(file, knowledgeEntityContract) === 'claim')
			: [];
		const p0Claims = profile.p0ClaimRule && entityContractConfigured
			? claims.filter(file => matchesScopeRule(file, profile.p0ClaimRule!))
			: [];
		const outputSources = sources.filter(source => source.kind === 'output');
		const evidenceDebt = activeClaimEvidenceDebt(claims, sources, data.knowledge, (claimFiles, usageSources, evidence) =>
			findClaimEvidenceDebt(claimFiles, usageSources, evidence, profile.usageSourceExclusions)
		);
		const p0ClaimDebt = findClaimEvidenceDebt(p0Claims, sources, data.knowledge, profile.usageSourceExclusions);
		const publishedUnreviewedOutputPaths = outputEntities
			.filter(file => isPublishedAwaitingReview(file.properties?.status, profile.outputLifecycle))
			.map(file => file.path);
		const knowledgeGraph = diagnoseKnowledgeGraph(data.knowledge, outputSources, profile.knowledgeEntities);
		return {
			status: 'ready',
			completedProjectPaths,
			activeClaimEvidenceDebt: evidenceDebt,
			p0ClaimDebt,
			p0ClaimEvidence: profile.p0ClaimRule && entityContractConfigured ? 'configured' : 'unconfigured',
			knowledgeGraph,
			publishedUnreviewedOutputPaths,
			outputLifecycle: isOutputLifecycleConfigured(profile.outputLifecycle) ? 'configured' : 'unconfigured'
		};
	}

	getIssues(result: WorkflowInspectionResult): WorkflowIssueIdentity[] {
		if (result.status === 'blocked') return [];
		const p0ClaimPaths = new Set(result.p0ClaimDebt.map(issue => this.normalizePath(issue.claimPath)));
		const nonP0ActiveClaimDebt = result.activeClaimEvidenceDebt.filter(issue => !p0ClaimPaths.has(this.normalizePath(issue.claimPath)));
		return [
			...result.p0ClaimDebt.map(issue => ({ id: `claim-evidence-debt:${this.normalizePath(issue.claimPath)}`, title: `P0 Claim 缺少结构化 Evidence：${issue.claimPath}` })),
			...nonP0ActiveClaimDebt.map(issue => ({ id: `claim-evidence-debt:${this.normalizePath(issue.claimPath)}`, title: `活跃 Claim 缺少结构化 Evidence：${issue.claimPath}` })),
			...result.knowledgeGraph.evidenceWithoutSupports.map(path => ({ id: `evidence-without-supports:${this.normalizePath(path)}`, title: `Evidence 缺少 supports：${path}` })),
			...result.knowledgeGraph.evidenceWithInvalidSupports.map(path => ({ id: `evidence-invalid-supports:${this.normalizePath(path)}`, title: `Evidence supports 格式无效：${path}` })),
			...result.knowledgeGraph.evidenceWithUnresolvedSupports.map(path => ({ id: `evidence-unresolved-supports:${this.normalizePath(path)}`, title: `Evidence supports 指向不存在的目标：${path}` })),
			...result.knowledgeGraph.evidenceWithNonClaimSupports.map(issue => ({ id: `evidence-non-claim-supports:${this.normalizePath(issue.evidencePath)}`, title: `Evidence supports 指向非 Claim：${issue.evidencePath}` })),
			...result.knowledgeGraph.questionsWithoutClaimLinks.map(path => ({ id: `question-without-claim-link:${this.normalizePath(path)}`, title: `Question 尚未关联 Claim（候选）：${path}` })),
			...result.knowledgeGraph.outputsWithoutClaimLinks.map(path => ({ id: `output-without-claim-link:${this.normalizePath(path)}`, title: `Output 尚未关联 Claim（候选）：${path}` })),
			...result.completedProjectPaths.map(path => ({ id: `completed-project:${this.normalizePath(path)}`, title: `已完成但仍在 Projects：${path}` })),
			...result.publishedUnreviewedOutputPaths.map(path => ({ id: `published-output:${this.normalizePath(path)}`, title: `已发布但未复盘的 Output：${path}` }))
		];
	}

	compareWithSnapshot(result: WorkflowInspectionResult, snapshot: WorkflowInspectionSnapshot | undefined): WorkflowInspectionDiff {
		return compareWorkflowInspectionSnapshot(this.getIssues(result), snapshot, this.getRuleSetVersion());
	}

	captureSnapshot(result: WorkflowInspectionResult, capturedAt = new Date().toISOString()): WorkflowInspectionSnapshot {
		return { ruleSetVersion: this.getRuleSetVersion(), capturedAt, issues: this.getIssues(result) };
	}

	private getProfile(): VaultProfile {
		const configured = this.plugin.settings.vaultProfile;
		if (isVaultProfile(configured)) return configured;
		return createLegacyVaultProfile(this.plugin.settings);
	}

	private normalizePath(path: string): string {
		return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();
	}

	/** A deterministic, non-reversible fingerprint prevents cross-rule trend comparisons. */
	private getRuleSetVersion(): number {
		const profile = this.getProfile();
		const material = JSON.stringify({
			inspectionRuleRevision: WORKFLOW_DIAGNOSTIC_RULESET_REVISION,
			projects: profile.projects,
			projectEntries: profile.projectEntries,
			outputs: profile.outputs,
			outputEntries: profile.outputEntries,
			p0ClaimRule: profile.p0ClaimRule,
			knowledgeEntities: profile.knowledgeEntities,
			knowledge: profile.knowledge,
			exclusions: profile.exclusions,
			usageSourceExclusions: profile.usageSourceExclusions,
			projectStatusAliases: profile.projectStatusAliases,
			outputLifecycle: profile.outputLifecycle
		});
		let hash = 2166136261;
		for (let index = 0; index < material.length; index++) {
			hash ^= material.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return hash >>> 0;
	}
}
