import { describe, expect, it } from 'vitest';
import {
  RUN_TRANSITIONS,
  canTransitionRun,
  isActiveRunState,
  isRunState,
  isTerminalRunState
} from '@agentos/schemas';
import { RunStateMachine } from '../src/state-machine.js';

describe('RunStateMachine', () => {
  it('starts in QUEUED by default', () => {
    const m = new RunStateMachine();
    expect(m.current).toBe('QUEUED');
    expect(m.isActive()).toBe(true);
    expect(m.isTerminal()).toBe(false);
  });

  it('rejects invalid initial states', () => {
    expect(() => new RunStateMachine('NOPE' as never)).toThrow('Invalid initial run state');
  });

  it('follows the happy path QUEUED -> PLANNING -> EXECUTING -> VERIFYING -> COMPLETED', () => {
    const m = new RunStateMachine();
    m.transition('PLANNING');
    m.transition('EXECUTING');
    m.transition('VERIFYING');
    m.transition('COMPLETED');
    expect(m.current).toBe('COMPLETED');
    expect(m.isTerminal()).toBe(true);
    expect(m.isActive()).toBe(false);
  });

  it('allows verification to loop back to EXECUTING', () => {
    const m = new RunStateMachine('VERIFYING');
    expect(m.canTransition('EXECUTING')).toBe(true);
    m.transition('EXECUTING');
    expect(m.current).toBe('EXECUTING');
  });

  it('rejects invalid transitions', () => {
    const m = new RunStateMachine('EXECUTING');
    expect(m.canTransition('PLANNING')).toBe(false);
    expect(() => m.transition('PLANNING')).toThrow('Invalid run state transition: EXECUTING -> PLANNING');
    expect(m.current).toBe('EXECUTING');
  });

  it('terminal states have no outgoing edges', () => {
    for (const state of ['FAILED', 'COMPLETED', 'CANCELLED'] as const) {
      const m = new RunStateMachine(state);
      for (const target of RUN_TRANSITIONS[state]) {
        expect(m.canTransition(target)).toBe(false);
      }
      expect(RUN_TRANSITIONS[state]).toHaveLength(0);
    }
  });

  it('every run state is recognized and categorized', () => {
    const active = ['QUEUED', 'PLANNING', 'EXECUTING', 'VERIFYING', 'PAUSED'];
    const terminal = ['FAILED', 'COMPLETED', 'CANCELLED'];
    for (const state of active) {
      expect(isRunState(state)).toBe(true);
      expect(isActiveRunState(state)).toBe(true);
      expect(isTerminalRunState(state)).toBe(false);
    }
    for (const state of terminal) {
      expect(isRunState(state)).toBe(true);
      expect(isActiveRunState(state)).toBe(false);
      expect(isTerminalRunState(state)).toBe(true);
    }
    expect(canTransitionRun('PAUSED', 'EXECUTING')).toBe(true);
    expect(canTransitionRun('COMPLETED', 'QUEUED')).toBe(false);
  });

  it('transition table is internally consistent (all targets are real states)', () => {
    for (const state of Object.keys(RUN_TRANSITIONS)) {
      expect(isRunState(state)).toBe(true);
      for (const target of RUN_TRANSITIONS[state as keyof typeof RUN_TRANSITIONS]) {
        expect(isRunState(target)).toBe(true);
      }
    }
  });
});