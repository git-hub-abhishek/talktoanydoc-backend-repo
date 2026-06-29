declare namespace awslambda {
  function streamifyResponse(
    handler: (event: any, responseStream: NodeJS.WritableStream, context: any) => Promise<void>
  ): any;
}
