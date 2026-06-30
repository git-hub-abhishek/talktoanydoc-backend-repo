// Set all required environment variables before any module is loaded.
// This prevents config.ts from throwing at cold-start validation.
process.env.UPLOAD_BUCKET = 'test-upload-bucket';
process.env.DOCUMENT_TABLE = 'test-document-table';
process.env.VECTOR_INDEX = 'test-vector-index';
process.env.BEDROCK_EMBED_MODEL_ID = 'amazon.titan-embed-text-v2:0';
process.env.BEDROCK_CHAT_MODEL_ID = 'anthropic.claude-sonnet-4-6';
process.env.OPENSEARCH_ENDPOINT = 'https://test.aoss.example.com';
process.env.COGNITO_USER_POOL_ID = 'eu-west-2_TestPool';
process.env.COGNITO_CLIENT_ID = 'testclientid';
process.env.GUARDRAIL_ID = 'test-guardrail-id';
process.env.INGEST_CONFIG_PARAM = '/talktodoc/ingest-config';
process.env.QUERY_CONFIG_PARAM = '/talktodoc/query-config';
