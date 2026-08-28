import { describe, it, expect } from 'vitest';
import {
    normalizeTrace,
    formatScore,
    formatTokensPerSecond,
    formatCost,
    timingBars,
} from '../src/lib/trace';
import type { RawTrace } from '../src/types/trace';

describe('normalizeTrace', () => {
    const fullTrace: RawTrace = {
        query: 'return policy',
        retrieved: [
            {
                id: 'a',
                title: 'Return',
                url: '/a',
                score: 0.9,
                textPreview: '...',
                chars: 20,
                keptInContext: true,
                rank: 1,
                category: null,
                text: '',
            },
        ],
        rerank: { didRerank: false, reason: 'above threshold' },
        context: { sources: [{ n: 1, id: 'a' }], length: 10 },
        timings: { embed: 1, retrieval: 2, rerank: 3, total: 6 },
        timedOut: false,
        finalPrompt: ['[1] system\nhi', '[3] user\nq'],
    };

    it('shapes a full trace payload for rendering', () => {
        const trace = normalizeTrace(fullTrace);
        expect(trace?.query).toBe('return policy');
        expect(trace?.retrieved).toHaveLength(1);
        expect(trace?.finalPrompt).toContain('[1] system');
        expect(trace?.timings?.embed).toBe(1);
    });

    it('returns null for an empty trace', () => {
        expect(normalizeTrace(null)).toBeNull();
        expect(normalizeTrace(undefined)).toBeNull();
    });

    it('surfaces a retrieval error so the sidebar can explain empty retrieval', () => {
        const trace = normalizeTrace({
            query: 'x',
            retrieved: [],
            rerank: { didRerank: false, reason: '' },
            context: { sources: [], length: 0 },
            error: { message: 'OpenRouter embeddings HTTP 500' },
            timedOut: true,
        });
        expect(trace?.error).toBeDefined();
        expect(trace?.error?.message).toContain('HTTP 500');
        expect(trace?.timedOut).toBe(true);
    });
});

describe('formatScore', () => {
    it('formats a score as a percentage', () => {
        expect(formatScore(0.9)).toBe('90%');
        expect(formatScore(1)).toBe('100%');
    });

    it('returns a placeholder for missing/NaN scores', () => {
        expect(formatScore(null)).toBe('—');
        expect(formatScore(undefined)).toBe('—');
        expect(formatScore(NaN)).toBe('—');
    });
});

describe('formatTokensPerSecond', () => {
    it('formats a positive rate as tok/s', () => {
        expect(formatTokensPerSecond(42.3)).toBe('42 tok/s');
        expect(formatTokensPerSecond(0)).toBe('—');
    });

    it('returns a placeholder for missing/NaN rates', () => {
        expect(formatTokensPerSecond(null)).toBe('—');
        expect(formatTokensPerSecond(undefined)).toBe('—');
        expect(formatTokensPerSecond(NaN)).toBe('—');
    });
});

describe('formatCost', () => {
    it('formats a small cost with more precision', () => {
        expect(formatCost(0.00012)).toBe('$0.0001');
        expect(formatCost(0.12)).toBe('$0.120');
    });

    it('returns a placeholder for missing/NaN costs', () => {
        expect(formatCost(null)).toBe('—');
        expect(formatCost(undefined)).toBe('—');
        expect(formatCost(NaN)).toBe('—');
    });
});

describe('normalizeTrace usage + token-speed passthrough', () => {
    it('surfaces usage, TTFT and tokens-per-second when present', () => {
        const trace = normalizeTrace({
            query: 'q',
            retrieved: [],
            rerank: { didRerank: false, reason: 'above threshold' },
            context: { sources: [], length: 0 },
            timings: { embed: 1, retrieval: 2, rerank: 3, total: 6 },
            ttftMs: 480,
            tokensPerSecond: 31.2,
            usage: { promptTokens: 120, completionTokens: 42, totalTokens: 162, cost: 0.0001 },
        });
        expect(trace?.ttftMs).toBe(480);
        expect(trace?.tokensPerSecond).toBe(31.2);
        expect(trace?.usage).toEqual({
            promptTokens: 120,
            completionTokens: 42,
            totalTokens: 162,
            cost: 0.0001,
        });
    });

    it('defaults usage fields to safe nulls when absent', () => {
        const trace = normalizeTrace({
            query: 'q',
            retrieved: [],
            rerank: { didRerank: false, reason: '' },
            context: { sources: [], length: 0 },
            timings: null,
        });
        expect(trace?.ttftMs).toBeUndefined();
        expect(trace?.tokensPerSecond).toBeUndefined();
        expect(trace?.usage).toBeNull();
    });
});

describe('timingBars', () => {
    it('returns one row per stage plus E2E, with ms and a width proportional to the largest', () => {
        const bars = timingBars({
            embed: 100,
            retrieval: 50,
            rerank: 25,
            generation: 200,
            total: 375,
            e2e: 575,
        });
        expect(bars.map((b) => b.label)).toEqual([
            'Embed',
            'Retrieve',
            'Rerank',
            'Generate',
            'E2E',
        ]);
        expect(bars.map((b) => b.ms)).toEqual([100, 50, 25, 200, 575]);
        // Largest is E2E (575ms) -> 100%; Generate is ~35%.
        expect(bars.find((b) => b.label === 'E2E')?.pct).toBe(100);
        expect(bars.find((b) => b.label === 'Generate')?.pct).toBe(35);
    });

    it('derives E2E from total + generation when e2e is absent', () => {
        const bars = timingBars({
            embed: 100,
            retrieval: 50,
            rerank: 25,
            generation: 200,
            total: 375,
        });
        expect(bars.find((b) => b.label === 'E2E')?.ms).toBe(575);
    });

    it('handles a missing generation timing gracefully (0-width bar, no NaN)', () => {
        const bars = timingBars({ embed: 10, retrieval: 20, rerank: 5, total: 35 });
        expect(bars).toHaveLength(5);
        const gen = bars.find((b) => b.label === 'Generate');
        expect(gen?.ms).toBe(0);
        expect(Number.isFinite(gen?.pct)).toBe(true);
        // E2E falls back to total when generation is absent.
        expect(bars.find((b) => b.label === 'E2E')?.ms).toBe(35);
    });

    it('returns an empty list when timings are absent', () => {
        expect(timingBars(null)).toEqual([]);
        expect(timingBars(undefined)).toEqual([]);
    });
});
