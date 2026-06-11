import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  renderDefaultDeliveryPolicyYaml,
  DELIVERY_POLICY_FILE,
} from '@/pipeline/delivery-policy.js';

/** Default PR body template (issue #42). Placeholders are filled at delivery time. */
const DEFAULT_PR_BODY = `## Summary

{summary}

## Ticket

{ticket}

## Test plan

- [ ] Unit / integration tests pass locally
- [ ] Manual verification on the affected surface
- [ ] Docs and registries updated

🤖 Generated with paqad-ai delivery
`;

/**
 * Issue #42 — `paqad-ai onboard` writes the delivery policy (enabled, all
 * sections `auto`) and the PR-body template it references. Mirrors
 * `generateFeatureDevelopmentPolicy`: coding domain only, `autoUpdate: false`
 * so project edits are never clobbered by a framework refresh.
 */
export function generateDeliveryPolicy(domain: 'coding' | 'content'): GeneratedFile[] {
  if (domain !== 'coding') {
    return [];
  }

  return [
    {
      path: `${PATHS.WORKFLOWS_DIR}/${DELIVERY_POLICY_FILE}`,
      content: renderDefaultDeliveryPolicyYaml(),
      autoUpdate: false,
    },
    {
      path: PATHS.DELIVERY_PR_BODY_TEMPLATE,
      content: DEFAULT_PR_BODY,
      autoUpdate: false,
    },
  ];
}
