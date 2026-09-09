import {
  RUN_TRANSITIONS,
  assertTransitionRun,
  canTransitionRun,
  isActiveRunState,
  isRunState,
  isTerminalRunState,
  type RunState
} from '@agentos/schemas';

/**
 * Deterministic run state machine backed by the shared transition table in
 * `@agentos/schemas`. Keep the transition table there so the API and the
 * worker agree on exactly one definition of the lifecycle.
 */
export class RunStateMachine {
  private state: RunState;

  constructor(initial: RunState = 'QUEUED') {
    if (!isRunState(initial)) {
      throw new Error(`Invalid initial run state "${String(initial)}".`);
    }
    this.state = initial;
  }

  get current(): RunState {
    return this.state;
  }

  canTransition(to: RunState): boolean {
    return canTransitionRun(this.state, to);
  }

  /** Transition or throw. Invalid transitions are rejected, never coerced. */
  transition(to: RunState): RunState {
    assertTransitionRun(this.state, to);
    this.state = to;
    return this.state;
  }

  isActive(): boolean {
    return isActiveRunState(this.state);
  }

  isTerminal(): boolean {
    return isTerminalRunState(this.state);
  }
}

export { RUN_TRANSITIONS, canTransitionRun, assertTransitionRun, isActiveRunState, isTerminalRunState, isRunState };
export type { RunState };