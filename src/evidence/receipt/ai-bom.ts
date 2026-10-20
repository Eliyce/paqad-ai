import { createHash } from 'node:crypto';

import type { ChangeAuthorship, InTotoStatement } from '@/core/types/evidence-ledger.js';

export interface CycloneDxProperty {
  name: string;
  value: string;
}

export interface CycloneDxComponent {
  type: 'file';
  name: string;
  hashes: { alg: 'SHA-256'; content: string }[];
}

export interface AiBomDocument {
  bomFormat: 'CycloneDX';
  specVersion: '1.6';
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp: string;
    tools: { vendor: string; name: string; version: string }[];
    properties: CycloneDxProperty[];
  };
  components: CycloneDxComponent[];
  properties: CycloneDxProperty[];
}

export interface BuildAiBomInput {
  statement: InTotoStatement;
  toolVersion: string;
}

export function buildAiBom(input: BuildAiBomInput): AiBomDocument {
  const { predicate } = input.statement;
  const graded = predicate.graded_results;

  const components: CycloneDxComponent[] = input.statement.subject.map((subject) => ({
    type: 'file',
    name: subject.name,
    hashes: [{ alg: 'SHA-256', content: subject.digest.sha256 }],
  }));

  const evidenceProps: CycloneDxProperty[] = [
    { name: 'paqad:verification:result', value: predicate.verification_result },
    { name: 'paqad:evidence:deterministic:pass', value: String(graded.deterministic.pass) },
    { name: 'paqad:evidence:deterministic:fail', value: String(graded.deterministic.fail) },
    { name: 'paqad:evidence:llm-judged:pass', value: String(graded.llm_judged.pass) },
    { name: 'paqad:evidence:llm-judged:fail', value: String(graded.llm_judged.fail) },
    { name: 'paqad:evidence:blocked', value: String(graded.blocked) },
    { name: 'paqad:evidence:inconclusive', value: String(graded.inconclusive) },
    { name: 'paqad:predicateType', value: input.statement.predicateType },
    ...authorshipProps(predicate.change_authorship),
  ];

  const serialSeed = JSON.stringify({
    subject: input.statement.subject,
    result: predicate.verification_result,
    graded,
    time: predicate.time_verified,
  });
  const serialNumber = `urn:uuid:${formatUuid(createHash('sha256').update(serialSeed).digest('hex'))}`;

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber,
    version: 1,
    metadata: {
      timestamp: predicate.time_verified,
      tools: [{ vendor: 'paqad', name: 'paqad-ai', version: input.toolVersion }],
      properties: evidenceProps,
    },
    components,
    properties: evidenceProps,
  };
}

function authorshipProps(authorship: ChangeAuthorship | undefined): CycloneDxProperty[] {
  if (authorship === undefined) return [];
  const props: CycloneDxProperty[] = [
    { name: 'paqad:authorship:provenance', value: authorship.provenance },
  ];
  if (authorship.agent !== undefined)
    props.push({ name: 'paqad:authorship:agent', value: authorship.agent });
  if (authorship.model !== undefined)
    props.push({ name: 'paqad:authorship:model', value: authorship.model });
  if (authorship.provider !== undefined)
    props.push({ name: 'paqad:authorship:provider', value: authorship.provider });
  if (authorship.model_id !== undefined)
    props.push({ name: 'paqad:authorship:model_id', value: authorship.model_id });
  if (authorship.accepting_human?.name !== undefined)
    props.push({
      name: 'paqad:authorship:accepting_human:name',
      value: authorship.accepting_human.name,
    });
  if (authorship.accepting_human?.email !== undefined)
    props.push({
      name: 'paqad:authorship:accepting_human:email',
      value: authorship.accepting_human.email,
    });
  return props;
}

function formatUuid(hex: string): string {
  const h = hex.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
