/**
 * DynamoDB operations for document metadata.
 *
 * The DocumentTable schema:
 *   PK: documentId (string)
 *   GSI: userId-index — allows listing all documents for a given user
 *
 * Status lifecycle:
 *   UPLOADING → REGISTERED → INGESTING → READY | FAILED
 *
 * All writes go through the DocumentClient (lib-dynamodb) which handles
 * marshalling/unmarshalling JavaScript types automatically.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { DocumentRecord } from '../types/document';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }));

/** Write a new document record (used by register-document handler). */
export async function putDocument(record: DocumentRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: config.documentTable, Item: record }));
}

/** Fetch a single document by its primary key. Returns undefined if not found. */
export async function getDocument(documentId: string): Promise<DocumentRecord | undefined> {
  const result = await client.send(new GetCommand({ TableName: config.documentTable, Key: { documentId } }));
  return result.Item as DocumentRecord | undefined;
}

/**
 * Update the ingestion status and updatedAt timestamp for a document.
 * Uses ExpressionAttributeNames to avoid colliding with the reserved word "status".
 */
export async function updateDocumentStatus(documentId: string, status: DocumentRecord['status']): Promise<void> {
  await client.send(new UpdateCommand({
    TableName: config.documentTable,
    Key: { documentId },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status, ':updatedAt': new Date().toISOString() }
  }));
}

/** List all documents owned by a user via the userId GSI. */
export async function listDocumentsByUser(userId: string): Promise<DocumentRecord[]> {
  const result = await client.send(new QueryCommand({
    TableName: config.documentTable,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: { ':userId': userId }
  }));
  return (result.Items ?? []) as DocumentRecord[];
}
