/**
 * Centralised configuration for all Lambda functions.
 *
 * All required environment variables are validated at cold-start via required().
 * If any variable is missing the Lambda will fail immediately with a clear error
 * rather than surfacing a confusing runtime failure later in the request.
 *
 * Variables are injected by SAM via the Globals.Function.Environment block in
 * template.yaml. Local overrides can be placed in .env (not committed).
 */

export const config = {
  /** AWS region — defaults to eu-west-2 but overridden by the Lambda runtime. */
  awsRegion: process.env.AWS_REGION || 'eu-west-2',

  /** S3 bucket that receives document uploads (pre-signed PUT URLs target this). */
  uploadBucket: required('UPLOAD_BUCKET'),

  /** DynamoDB table that stores document metadata and ingestion status. */
  documentTable: required('DOCUMENT_TABLE'),

  /** OpenSearch index name where chunk vectors are stored. */
  vectorIndex: required('VECTOR_INDEX'),

  /** Bedrock model ID used to generate embeddings (Titan Embed Text v2, 1024-dim). */
  bedrockEmbedModelId: required('BEDROCK_EMBED_MODEL_ID'),

  /** Bedrock model ID used to generate answers (Claude Sonnet 4.6, streaming). */
  bedrockChatModelId: required('BEDROCK_CHAT_MODEL_ID'),

  /** HTTPS endpoint for the OpenSearch Serverless collection. */
  openSearchEndpoint: required('OPENSEARCH_ENDPOINT'),

  /** Cognito User Pool ID — used by the stream handler to verify JWTs directly. */
  cognitoUserPoolId: required('COGNITO_USER_POOL_ID'),

  /** Cognito App Client ID — paired with cognitoUserPoolId for JWT verification. */
  cognitoClientId: required('COGNITO_CLIENT_ID'),

  /** Bedrock Guardrail ID applied to every InvokeModel call. */
  guardrailId: required('GUARDRAIL_ID'),

  /** Guardrail version — DRAFT during development, a numeric version after publishing. */
  guardrailVersion: process.env.GUARDRAIL_VERSION || 'DRAFT',

  /** SSM parameter path for ingestion config (chunkSize, overlap). */
  ingestConfigParam: required('INGEST_CONFIG_PARAM'),

  /** SSM parameter path for query config (kNeighbours, rerankedCandidates, maxTokens). */
  queryConfigParam: required('QUERY_CONFIG_PARAM'),

  /** Maximum file size accepted by /generate-url (configurable, default 100 MB). */
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || '100'),

  /** How long pre-signed upload URLs remain valid in seconds (default 5 min). */
  signedUrlExpirySeconds: Number(process.env.SIGNED_URL_EXPIRY_SECONDS || '300')
};

/** Throw at cold-start if a required environment variable is absent. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}
