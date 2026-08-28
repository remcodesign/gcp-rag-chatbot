/**
 * Embedding provider boundary — the seam the seed job uses to compute vectors.
 *
 * The real adapter (`openRouterEmbedder.ts`) uses OpenRouter; tests inject an
 * in-memory stub. `embed` takes one string or an array and returns one vector
 * or a batch of vectors respectively.
 */

export interface Embedder {
    embed(input: string | string[]): Promise<number[] | number[][]>;
    readonly model: string;
    readonly dimensions: number;
}
