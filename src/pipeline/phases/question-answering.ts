import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { PhaseExecutor } from './phase.interface.js';
import type { PipelineRunContext } from '@/core/types/pipeline.js';

import { createPassResult } from './shared.js';
import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { ProjectKnowledgeAnswerer } from '@/project-knowledge/index.js';

export class ProjectQuestionPhase implements PhaseExecutor {
  readonly phase = 'question-answering' as const;

  async execute(context: PipelineRunContext) {
    if (context.classification.workflow !== 'project-question') {
      return createPassResult(this.phase, 'No project-question workflow requested', context);
    }

    const answerer = new ProjectKnowledgeAnswerer();
    const answer = await answerer.answer({
      question: context.classification.request_text,
      mode: 'explain',
      project_root: context.project_root,
    });

    const answerArtifactPath = PATHS.PROJECT_QUESTION_ANSWER;
    const target = toPosixPath(join(context.project_root, answerArtifactPath));
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(answer, null, 2)}\n`, 'utf8');
    await rename(tmp, target);

    return createPassResult(
      this.phase,
      `Project question answered [${answer.grounding_state}]: ${answer.answer.slice(0, 200)}`,
      context,
      [answerArtifactPath, `answer:${answer.grounding_state}`],
    );
  }
}
