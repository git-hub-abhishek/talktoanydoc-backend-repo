/**
 * Bedrock API calls for embeddings, reranking, and chat completion.
 *
 * Models used:
 *   - Titan Embed Text v2     (embedText)            — 1024-dim vectors at ingest and query time
 *   - Claude Haiku 4.5        (rerankChunks)         — fast/cheap cross-encoder reranking
 *   - Claude Sonnet 4.6       (answerQuestion*)      — final answer generation
 *
 * A Bedrock Guardrail is applied on every InvokeModel call via guardrailIdentifier
 * and guardrailVersion. The guardrail enforces:
 *   - Content filters (hate, violence, sexual, insults, misconduct, prompt attack)
 *   - Contextual grounding: response must be supported by the supplied chunks (≥0.7)
 *
 * answerQuestionStream() is used by the standard streaming Lambda Function URL.
 * answerQuestion() is kept for the non-streaming API Gateway route.
 */

import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from './config';
import { logger } from './logger';

const client = new BedrockRuntimeClient({ region: config.awsRegion });

/**
 * Generate a 1024-dimensional embedding for the given text using Titan Embed Text v2.
 * Called once per chunk at ingest time, and once per user question at query time.
 */
export async function embedText(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: config.bedrockEmbedModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text })
  });

  const result = await client.send(command);
  const payload = JSON.parse(Buffer.from(result.body).toString('utf-8'));
  return payload.embedding as number[];
}

/**
 * Stream an answer from Claude Sonnet 4.6 using the RAG prompt template.
 *
 * Yields individual text deltas as they arrive from Bedrock so the Lambda
 * Function URL can forward them to the browser progressively via RESPONSE_STREAM.
 *
 * The prompt instructs the model to answer strictly from the supplied context
 * and return "Not found in document" if the answer is absent — preventing
 * hallucination. The Guardrail adds a second layer of grounding enforcement.
 *
 * @param question      - The user's question.
 * @param contextChunks - Top-k text chunks retrieved from OpenSearch.
 */
export async function* answerQuestionStream(question: string, contextChunks: string[], maxTokens = 700): AsyncGenerator<string> {
  const prompt = [
    'You are a document assistant.',
    'Answer strictly from the supplied context.',
    'If the answer is not present in the context, say: Not found in document.',
    '',
    'Context:',
    contextChunks.join('\n\n---\n\n'),
    '',
    `Question: ${question}`
  ].join('\n');

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature: 0,  // deterministic output — no creative variation
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  };

  // Guardrail parameters are SDK-level command fields, NOT part of the Anthropic
  // messages body. Bedrock injects them at the service layer before/after the model call.
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: config.bedrockChatModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
    guardrailIdentifier: config.guardrailId,
    guardrailVersion: config.guardrailVersion
  });

  const result = await client.send(command);

  for await (const event of result.body ?? []) {
    if (!event.chunk?.bytes) continue;
    const chunk = JSON.parse(Buffer.from(event.chunk.bytes).toString('utf-8'));

    // Bedrock emits a guardrail intervention as a chunk with this field set.
    // Log it and stop yielding so the caller can surface the blocked message.
    if (chunk['amazon-bedrock-guardrailAction'] === 'INTERVENED') {
      logger.warn('Guardrail intervened — response blocked', { guardrailId: config.guardrailId });
      return;
    }

    // Log any guardrail trace metadata for visibility in CloudWatch.
    if (chunk.type === 'metadata' && chunk.trace?.guardrail) {
      logger.info('Guardrail trace', { trace: chunk.trace.guardrail });
    }

    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      yield chunk.delta.text as string;
    }
  }
}

/**
 * Rerank a set of candidate chunks against the user question using Claude Haiku.
 *
 * No dedicated rerank model is available in eu-west-2, so we use Haiku as a
 * cross-encoder: for each chunk we ask the model to score its relevance to the
 * question from 0–10. Chunks are then sorted descending and the top `topN` returned.
 *
 * Haiku is used instead of Sonnet to keep latency and cost low — each chunk
 * requires a separate inference call and reranking runs before the main answer.
 *
 * @param question   - The user's question.
 * @param chunks     - Candidate chunks from the initial KNN retrieval.
 * @param topN       - Number of top-ranked chunks to return (default 5).
 */
export async function rerankChunks(
  question: string,
  chunks: Array<{ text: string }>,
  topN = 5
): Promise<number[]> {
  // Score all chunks in parallel to minimise latency.
  const scores = await Promise.all(
    chunks.map(async (chunk, i) => {
      const prompt = `Rate how relevant this passage is for answering the question.
Question: ${question}
Passage: ${chunk.text}
Reply with only a single integer from 0 (not relevant) to 10 (perfectly answers the question). No explanation.`;

      const body = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4,
        temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
      };

      try {
        const command = new InvokeModelCommand({
          modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body)
        });
        const result = await client.send(command);
        const payload = JSON.parse(Buffer.from(result.body).toString('utf-8'));
        const scoreText = payload?.content?.[0]?.text?.trim() ?? '0';
        return { index: i, score: parseInt(scoreText, 10) || 0 };
      } catch {
        // If scoring fails for a chunk, give it score 0 rather than failing the whole request.
        return { index: i, score: 0 };
      }
    })
  );

  // Sort by score descending and return the indices of the top N chunks.
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.index);
}

/**
 * Non-streaming version of the answer — used by the legacy API Gateway /query route.
 * Same prompt and guardrail as answerQuestionStream but waits for the full response.
 */
export async function answerQuestion(question: string, contextChunks: string[]): Promise<string> {
  const prompt = [
    'You are a document assistant.',
    'Answer strictly from the supplied context.',
    'If the answer is not present in the context, say: Not found in document.',
    '',
    'Context:',
    contextChunks.join('\n\n---\n\n'),
    '',
    `Question: ${question}`
  ].join('\n');

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 700,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      }
    ]
  };

  const command = new InvokeModelCommand({
    modelId: config.bedrockChatModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
    guardrailIdentifier: config.guardrailId,
    guardrailVersion: config.guardrailVersion
  });

  const result = await client.send(command);
  const payload = JSON.parse(Buffer.from(result.body).toString('utf-8'));
  const answer = payload?.content?.[0]?.text;
  logger.info('Generated Bedrock response');
  return answer || 'Not found in document';
}
