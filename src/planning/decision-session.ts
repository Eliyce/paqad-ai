import type { DecisionRecord } from '@/core/types/planning.js';

import type {
  DecisionCategory,
  DecisionCarryOverScope,
  DecisionPacket,
} from './decision-packet.js';

export interface CarryOverPreference {
  source_decision_id: string;
  scope: Exclude<DecisionCarryOverScope, 'none'>;
  task_session_id: string;
  category: DecisionCategory;
  option_keys: string[];
  chosen_option_key: string;
  record: DecisionRecord;
}

export class DecisionSessionState {
  private readonly carryOvers: CarryOverPreference[] = [];

  private readonly taskScreenCounts = new Map<string, number>();

  addCarryOver(packet: DecisionPacket, record: DecisionRecord): void {
    const scope = packet.human_response?.carry_over_scope;
    const chosenOptionKey = packet.human_response?.chosen_option_key;
    if (scope === 'none' || !scope || !chosenOptionKey) {
      return;
    }

    const nextPreference: CarryOverPreference = {
      source_decision_id: packet.decision_id,
      scope,
      task_session_id: packet.task_session_id,
      category: packet.category,
      option_keys: packet.options.map((option) => option.option_key),
      chosen_option_key: chosenOptionKey,
      record,
    };
    const existingIndex = this.carryOvers.findIndex(
      (entry) =>
        entry.scope === nextPreference.scope &&
        entry.task_session_id === nextPreference.task_session_id &&
        entry.category === nextPreference.category &&
        entry.chosen_option_key === nextPreference.chosen_option_key,
    );
    if (existingIndex >= 0) {
      this.carryOvers.splice(existingIndex, 1, nextPreference);
      return;
    }
    this.carryOvers.push(nextPreference);
  }

  findCarryOver(
    packet: Pick<DecisionPacket, 'category' | 'options'>,
    taskSessionId: string,
  ): CarryOverPreference | null {
    const optionKeys = packet.options.map((option) => option.option_key);
    for (let index = this.carryOvers.length - 1; index >= 0; index -= 1) {
      const entry = this.carryOvers[index]!;
      if (entry.category !== packet.category) {
        continue;
      }
      if (entry.scope === 'task' && entry.task_session_id !== taskSessionId) {
        continue;
      }
      if (!entry.option_keys.some((optionKey) => optionKeys.includes(optionKey))) {
        continue;
      }
      if (!optionKeys.includes(entry.chosen_option_key)) {
        continue;
      }
      return entry;
    }
    return null;
  }

  getScreenCount(taskSessionId: string): number {
    return this.taskScreenCounts.get(taskSessionId) ?? 0;
  }

  hasReachedScreenCap(taskSessionId: string, maxScreensPerTask = 3): boolean {
    return this.getScreenCount(taskSessionId) >= maxScreensPerTask;
  }

  recordScreenShown(taskSessionId: string): number {
    const nextCount = this.getScreenCount(taskSessionId) + 1;
    this.taskScreenCounts.set(taskSessionId, nextCount);
    return nextCount;
  }
}
