// Stub config so tests never need real environment variables
export const config = {
  awsRegion: 'eu-west-2',
  uploadBucket: 'test-upload-bucket',
  documentTable: 'test-document-table',
  vectorIndex: 'test-vector-index',
  bedrockEmbedModelId: 'amazon.titan-embed-text-v2:0',
  bedrockChatModelId: 'anthropic.claude-sonnet-4-6',
  openSearchEndpoint: 'https://test.aoss.example.com',
  cognitoUserPoolId: 'eu-west-2_TestPool',
  cognitoClientId: 'testclientid',
  guardrailId: 'test-guardrail-id',
  guardrailVersion: 'DRAFT',
  ingestConfigParam: '/talktodoc/ingest-config',
  queryConfigParam: '/talktodoc/query-config',
  maxUploadSizeMb: 100,
  signedUrlExpirySeconds: 300,
};
